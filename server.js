import express from "express";
import cors from "cors";
import Jimp from "jimp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import https from "https";
import http from "http";

let sharp = null;
try {
    sharp = (await import("sharp")).default;
    console.log("⚡ [Sharp Engine] Carregado com sucesso! Suporte a AVIF, WebP, SVG, HEIC, TIFF, PNG, JPEG e GIF ativado.");
} catch (e) {
    console.log("⚠️ [Sharp Engine] Não encontrado. Usando Jimp como motor secundário.");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(__dirname));

// ================= CONFIGURAÇÕES DE SEGURANÇA E LIMITES =================
const MAX_BUFFER_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_PIXELS = 500000; // Limite seguro de pixels para o Roblox
const MAX_DIMENSION = 800; // Tamanho máximo por lado
const TIMEOUT_MS = 15000; // 15 segundos timeout por download

// Headers para simular um navegador Chrome de verdade
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,text/html;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

// Normalizar URLs problemáticas (Discord CDN / Cloudinary f_auto)
function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return url;
    let cleanUrl = url.trim();

    // Fix Cloudinary f_auto quando Sharp não estiver ativo
    if (!sharp && cleanUrl.includes('cloudinary.com') && cleanUrl.includes('f_auto')) {
        cleanUrl = cleanUrl.replace('f_auto', 'f_jpg');
    }

    // Fix Discord Media Proxy
    if (cleanUrl.includes('media.discordapp.net/attachments')) {
        cleanUrl = cleanUrl.replace('media.discordapp.net', 'cdn.discordapp.com');
    }

    return cleanUrl;
}

// Extrair imagem de páginas HTML (OpenGraph / Meta Tags)
function extractImageFromHTML(htmlText, baseUrl) {
    if (!htmlText) return null;

    const ogMatch = htmlText.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["']\s+content=["']([^"']+)["']/i) ||
                    htmlText.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["']/i);
    
    if (ogMatch && ogMatch[1]) {
        let imgUrl = ogMatch[1];
        if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        else if (imgUrl.startsWith('/')) {
            const parsedBase = new URL(baseUrl);
            imgUrl = `${parsedBase.protocol}//${parsedBase.host}${imgUrl}`;
        }
        return imgUrl;
    }

    const imgMatch = htmlText.match(/<img\s+[^>]*src=["']([^"']+\.(?:png|jpg|jpeg|webp|gif|avif|svg))["']/i);
    if (imgMatch && imgMatch[1]) {
        let imgUrl = imgMatch[1];
        if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        else if (imgUrl.startsWith('/')) {
            const parsedBase = new URL(baseUrl);
            imgUrl = `${parsedBase.protocol}//${parsedBase.host}${imgUrl}`;
        }
        return imgUrl;
    }

    return null;
}

// Fazer download de qualquer URL com suporte a redirects, timeouts, base64 e extrator de HTML
function downloadImageBuffer(urlStr, depth = 0) {
    return new Promise((resolve, reject) => {
        if (depth > 5) {
            return reject(new Error('Muitos redirecionamentos (Max 5)'));
        }

        // Tratar Data URLs (Base64)
        if (urlStr.startsWith('data:image/') || urlStr.startsWith('data:application/')) {
            try {
                const base64Data = urlStr.split(',')[1];
                if (!base64Data) return reject(new Error('Data URL inválida'));
                return resolve({ buffer: Buffer.from(base64Data, 'base64'), contentType: 'image/png' });
            } catch (err) {
                return reject(new Error('Falha ao decodificar Base64'));
            }
        }

        urlStr = sanitizeUrl(urlStr);
        let parsedUrl;
        try {
            parsedUrl = new URL(urlStr);
        } catch (err) {
            return reject(new Error('URL inválida ou mal formatada'));
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                ...BROWSER_HEADERS,
                'Host': parsedUrl.hostname,
                'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
            }
        };

        const req = protocol.get(options, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                let redirectUrl = response.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
                }
                return downloadImageBuffer(redirectUrl, depth + 1).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                return reject(new Error(`HTTP ${response.statusCode}: Servidor respondeu com erro`));
            }

            const contentType = response.headers['content-type'] || '';
            let total = 0;
            const chunks = [];

            response.on('data', (chunk) => {
                total += chunk.length;
                if (total > MAX_BUFFER_SIZE) {
                    req.destroy();
                    return reject(new Error(`Imagem excede o limite de ${MAX_BUFFER_SIZE / (1024 * 1024)}MB`));
                }
                chunks.push(chunk);
            });

            response.on('end', async () => {
                const buffer = Buffer.concat(chunks);
                
                if (contentType.includes('text/html') || buffer.slice(0, 100).toString('utf-8').includes('<html')) {
                    const htmlText = buffer.toString('utf-8');
                    const extractedImg = extractImageFromHTML(htmlText, urlStr);
                    if (extractedImg && extractedImg !== urlStr) {
                        console.log('🔗 Imagem extraída de página HTML:', extractedImg);
                        return downloadImageBuffer(extractedImg, depth + 1).then(resolve).catch(reject);
                    } else {
                        return reject(new Error('A URL informada é uma página da web sem imagem direta encontrada'));
                    }
                }

                resolve({ buffer, contentType });
            });

            response.on('error', reject);
        });

        req.on('error', (err) => {
            if (urlStr.includes('cdn.discordapp.com') && depth === 0) {
                const fallbackUrl = urlStr.replace('cdn.discordapp.com', 'media.discordapp.net');
                return downloadImageBuffer(fallbackUrl, depth + 1).then(resolve).catch(() => reject(err));
            }
            reject(err);
        });

        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error('Tempo limite da requisição atingido (Timeout)'));
        });
    });
}

// Processar Imagem com Sharp (AVIF, WebP, SVG, PNG, JPG, GIF, HEIC, TIFF) + Fallback Jimp
async function processImageToPixels(urlOrBase64, maxResRequested) {
    const maxRes = parseInt(maxResRequested) || MAX_DIMENSION;
    let buffer;

    if (urlOrBase64.startsWith('data:image/') || urlOrBase64.startsWith('http://') || urlOrBase64.startsWith('https://')) {
        const downloadResult = await downloadImageBuffer(urlOrBase64);
        buffer = downloadResult.buffer;
    } else if (/^[A-Za-z0-9+/=]+$/.test(urlOrBase64.trim().replace(/\s/g, ''))) {
        buffer = Buffer.from(urlOrBase64.trim(), 'base64');
    } else {
        throw new Error('Formato de URL ou Base64 inválido');
    }

    let width, height, pixels;

    // MOTOR 1: Sharp (Suporta AVIF, WebP, SVG, HEIC, TIFF, GIF, PNG, JPEG)
    if (sharp) {
        try {
            let pipeline = sharp(buffer, { animated: false });
            const metadata = await pipeline.metadata();

            width = metadata.width;
            height = metadata.height;

            if (!width || !height) {
                throw new Error("Não foi possível ler as dimensões da imagem");
            }

            // Redimensionamento proporcional
            if (width > maxRes || height > maxRes) {
                const scale = Math.min(maxRes / width, maxRes / height);
                width = Math.floor(width * scale);
                height = Math.floor(height * scale);
            }

            if (width * height > MAX_PIXELS) {
                const scale = Math.sqrt(MAX_PIXELS / (width * height));
                width = Math.floor(width * scale);
                height = Math.floor(height * scale);
            }

            const rawBuffer = await pipeline
                .resize(width, height, { fit: 'fill' })
                .removeAlpha() // Garante apenas canais RGB
                .raw()
                .toBuffer();

            const totalPixels = width * height;
            pixels = new Array(totalPixels);

            for (let i = 0; i < totalPixels; i++) {
                const r = rawBuffer[i * 3];
                const g = rawBuffer[i * 3 + 1];
                const b = rawBuffer[i * 3 + 2];
                pixels[i] = [r, g, b];
            }

            console.log(`⚡ [Sharp] Imagem processada com sucesso: ${width}x${height} (${metadata.format ? metadata.format.toUpperCase() : 'DESCONHECIDO'})`);

            return { Width: width, Height: height, Pixels: pixels };
        } catch (sharpErr) {
            console.warn(`⚠️ [Sharp Engine] Falhou, tentando fallback com Jimp:`, sharpErr.message);
        }
    }

    // MOTOR 2: Jimp (Fallback para sistemas sem Sharp)
    let image;
    try {
        image = await Jimp.read(buffer);
    } catch (jimpErr) {
        throw new Error(`Falha ao decodificar imagem (formato não suportado ou corrompido): ${jimpErr.message}`);
    }

    width = image.bitmap.width;
    height = image.bitmap.height;

    if (width > maxRes || height > maxRes) {
        const scale = Math.min(maxRes / width, maxRes / height);
        image.resize(Math.floor(width * scale), Math.floor(height * scale));
        width = image.bitmap.width;
        height = image.bitmap.height;
    }

    if (width * height > MAX_PIXELS) {
        const scale = Math.sqrt(MAX_PIXELS / (width * height));
        image.resize(Math.floor(width * scale), Math.floor(height * scale));
        width = image.bitmap.width;
        height = image.bitmap.height;
    }

    const totalPixels = width * height;
    pixels = new Array(totalPixels);
    let idx = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(x, y));
            pixels[idx++] = [r, g, b];
        }
    }

    console.log(`✅ [Jimp] Imagem processada com sucesso: ${width}x${height}`);

    return { Width: width, Height: height, Pixels: pixels };
}

// ================= ROTAS DA API =================

app.get('/parse', async (req, res) => {
    const url = req.query.url;
    const maxRes = req.query.maxRes;

    if (!url) {
        return res.status(400).json({ error: 'Parâmetro ?url= ou base64 ausente' });
    }

    try {
        console.log('📥 [GET /parse] Processando URL:', url.substring(0, 120) + (url.length > 120 ? '...' : ''));
        const result = await processImageToPixels(url, maxRes);
        res.json(result);
    } catch (err) {
        console.error('❌ Erro:', err.message);
        res.status(500).json({
            error: 'Falha ao processar imagem',
            details: err.message
        });
    }
});

app.post('/parse', async (req, res) => {
    const url = req.body.url || req.body.image || req.body.base64;
    const maxRes = req.body.maxRes;

    if (!url) {
        return res.status(400).json({ error: 'Campo "url" ou "base64" ausente no corpo da requisição' });
    }

    try {
        console.log('📥 [POST /parse] Processando imagem...');
        const result = await processImageToPixels(url, maxRes);
        res.json(result);
    } catch (err) {
        console.error('❌ Erro:', err.message);
        res.status(500).json({
            error: 'Falha ao processar imagem',
            details: err.message
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'Imagem para Roblox.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        engine: sharp ? 'sharp' : 'jimp',
        memory: process.memoryUsage(),
        supportedFormats: sharp ? ['AVIF', 'WEBP', 'SVG', 'PNG', 'JPEG', 'GIF', 'HEIC', 'TIFF', 'BMP'] : ['PNG', 'JPEG', 'BMP', 'GIF', 'TIFF'],
        limits: {
            maxBufferMB: MAX_BUFFER_SIZE / (1024 * 1024),
            maxPixels: MAX_PIXELS,
            maxResolution: MAX_DIMENSION
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('========================================');
    console.log(`🚀 Servidor de Extração Universal rodando na porta ${PORT}`);
    console.log(`⚙️ Motor de imagem ativo: ${sharp ? 'SHARP (Todos os formatos: AVIF, WebP, SVG, PNG, JPG, GIF, HEIC)' : 'JIMP'}`);
    console.log(`🌐 API GET:  /parse?url=<URL_OU_DISCORD_OU_BASE64>`);
    console.log(`🌐 API POST: /parse (JSON body)`);
    console.log('========================================');
});
