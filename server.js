import express from "express";
import cors from "cors";
import Jimp from "jimp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import https from "https";
import http from "http";

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

// Headers para simular um navegador Chrome de verdade (evita bloqueios Cloudflare/Discord/Imgur/Pinterest)
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

// Normalizar URLs do Discord (CDN vs Media Proxy)
function fixDiscordUrl(url) {
    if (!url || typeof url !== 'string') return url;
    
    // Se for URL media.discordapp.net/attachments -> mudar para cdn.discordapp.com se der erro
    if (url.includes('media.discordapp.net/attachments')) {
        return url.replace('media.discordapp.net', 'cdn.discordapp.com');
    }
    
    return url;
}

// Extrair imagem direta de páginas HTML (OpenGraph / Meta Tags / Imgur / Pinterest / Tenor)
function extractImageFromHTML(htmlText, baseUrl) {
    if (!htmlText) return null;

    // Buscar og:image ou twitter:image
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

    // Buscar primeira tag <img> com src válido
    const imgMatch = htmlText.match(/<img\s+[^>]*src=["']([^"']+\.(?:png|jpg|jpeg|webp|gif))["']/i);
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

        urlStr = fixDiscordUrl(urlStr);
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
            // Suporte a Redirecionamento (301, 302, 307, 308)
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
                
                // Se a resposta for uma página HTML (ex: Imgur page, Pinterest, Tenor page)
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
            // Se falhou no CDN do Discord, tentar no media.discordapp.net como fallback
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

// Carregar Imagem com tratamento universal de formatos
async function processImageToPixels(urlOrBase64, maxResRequested) {
    const maxRes = parseInt(maxResRequested) || MAX_DIMENSION;
    let buffer;

    if (urlOrBase64.startsWith('data:image/') || urlOrBase64.startsWith('http://') || urlOrBase64.startsWith('https://')) {
        const downloadResult = await downloadImageBuffer(urlOrBase64);
        buffer = downloadResult.buffer;
    } else if (/^[A-Za-z0-9+/=]+$/.test(urlOrBase64.trim().replace(/\s/g, ''))) {
        // String Base64 pura
        buffer = Buffer.from(urlOrBase64.trim(), 'base64');
    } else {
        throw new Error('Formato de URL ou Base64 inválido');
    }

    let image;
    try {
        image = await Jimp.read(buffer);
    } catch (jimpErr) {
        throw new Error(`Falha ao decodificar formato da imagem: ${jimpErr.message}`);
    }

    let width = image.bitmap.width;
    let height = image.bitmap.height;

    // Limitar dimensão máxima por lado
    if (width > maxRes || height > maxRes) {
        const scale = Math.min(maxRes / width, maxRes / height);
        image.resize(Math.floor(width * scale), Math.floor(height * scale));
        width = image.bitmap.width;
        height = image.bitmap.height;
    }

    // Limitar total de pixels para performance do Roblox
    if (width * height > MAX_PIXELS) {
        const scale = Math.sqrt(MAX_PIXELS / (width * height));
        image.resize(Math.floor(width * scale), Math.floor(height * scale));
        width = image.bitmap.width;
        height = image.bitmap.height;
    }

    console.log(`✅ Imagem processada com sucesso: ${width}x${height} (${width * height} pixels)`);

    const totalPixels = width * height;
    const pixels = new Array(totalPixels);
    let i = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(x, y));
            pixels[i++] = [r, g, b];
        }
    }

    return {
        Width: width,
        Height: height,
        Pixels: pixels
    };
}

// ================= ROTAS DA API =================

// Rota GET /parse?url=...
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

// Rota POST /parse com JSON body { url: "...", maxRes: 800 } ou { base64: "..." }
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
        memory: process.memoryUsage(),
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
    console.log(`🌐 API GET:  /parse?url=<URL_OU_DISCORD_OU_BASE64>`);
    console.log(`🌐 API POST: /parse (JSON body)`);
    console.log('🛡️ Suporte a Discord, Imgur, Tenor, Pinterest, Base64 e Webpages ATIVO');
    console.log('========================================');
});
