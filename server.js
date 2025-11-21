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
app.use(express.json());

// Servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(__dirname));

// Função para verificar se é URL do Discord
function isDiscordURL(url) {
    if (!url || typeof url !== 'string') return false;
    return /discordapp\.com/i.test(url) || 
           /cdn\.discordapp\.com/i.test(url) || 
           /discord\.com/i.test(url) ||
           /media\.discordapp\.net/i.test(url);
}

// Função para baixar imagem usando Node.js nativo (mais confiável)
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
        };
        
        protocol.get(url, options, (response) => {
            // Seguir redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                return downloadImage(response.headers.location)
                    .then(resolve)
                    .catch(reject);
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

// Função para processar URL do Discord
async function processDiscordURL(url) {
    console.log(`🔷 Processando URL do Discord`);
    console.log(`   URL: ${url}`);
    
    try {
        // Método 1: Download direto com Node.js https (mais confiável)
        console.log(`  📥 Tentativa 1: Download direto com Node.js https...`);
        const buffer = await downloadImage(url);
        console.log(`  ✅ Download OK! Tamanho: ${buffer.length} bytes`);
        
        const image = await Jimp.read(buffer);
        console.log(`  ✅ Jimp processou! Dimensões: ${image.bitmap.width}x${image.bitmap.height}`);
        return image;
        
    } catch (error1) {
        console.log(`  ❌ Método 1 falhou: ${error1.message}`);
        
        // Método 2: Fetch API
        try {
            console.log(`  📥 Tentativa 2: Fetch API...`);
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            console.log(`  ✅ Fetch OK! Tamanho: ${arrayBuffer.byteLength} bytes`);
            
            const buffer = Buffer.from(arrayBuffer);
            const image = await Jimp.read(buffer);
            console.log(`  ✅ Jimp processou! Dimensões: ${image.bitmap.width}x${image.bitmap.height}`);
            return image;
            
        } catch (error2) {
            console.log(`  ❌ Método 2 falhou: ${error2.message}`);
            
            // Método 3: Jimp direto (último recurso)
            try {
                console.log(`  📥 Tentativa 3: Jimp.read direto...`);
                const image = await Jimp.read(url);
                console.log(`  ✅ Jimp direto funcionou! Dimensões: ${image.bitmap.width}x${image.bitmap.height}`);
                return image;
            } catch (error3) {
                console.log(`  ❌ Método 3 falhou: ${error3.message}`);
                throw new Error(`Todos os métodos falharam. Últimos erros:\n1. ${error1.message}\n2. ${error2.message}\n3. ${error3.message}`);
            }
        }
    }
}

// Endpoint para processar imagens de URLs
app.get("/parse", async (req, res) => {
    // Reconstruir a URL completa a partir de TODOS os query parameters
    const queryString = req.url.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    
    let url = params.get('url');
    const maxRes = parseInt(params.get('maxRes')) || 0;
    const highQuality = params.get('highQuality') !== 'false'; // Padrão: true
    
    // Se a URL tiver parâmetros próprios (&is=, &hm=, etc), reconstruir
    if (isDiscordURL(url)) {
        // Pegar TODA a parte após "url=" até o fim ou até "&maxRes"
        const urlMatch = req.url.match(/[?&]url=([^&]*(?:&(?!maxRes|highQuality)[^&]*)*)/);
        if (urlMatch) {
            url = decodeURIComponent(urlMatch[1]);
        }
        
        // Forçar qualidade máxima em URLs do Discord
        if (!url.includes('?')) {
            url += '?quality=lossless';
        } else if (!url.includes('quality=')) {
            url += '&quality=lossless';
        }
    }
    
    if (!url) {
        return res.status(400).json({ error: "Missing ?url= parameter" });
    }

    console.log(`\n📥 Nova requisição: ${url}`);
    console.log(`📊 Configurações: maxRes=${maxRes || 'sem limite'}, highQuality=${highQuality}`);

    try {
        let image;
        
        // Tratamento especial para URLs do Discord
        if (isDiscordURL(url)) {
            console.log('🔷 URL do Discord detectada!');
            image = await processDiscordURL(url);
        } else {
            console.log('🌐 Carregando imagem normal...');
            image = await Jimp.read(url);
            console.log(`✅ Imagem carregada: ${image.bitmap.width}x${image.bitmap.height}`);
        }

        let width = image.bitmap.width;
        let height = image.bitmap.height;

        // Aplicar resolução máxima se especificada
        if (maxRes > 0 && (width > maxRes || height > maxRes)) {
            const scale = Math.min(maxRes / width, maxRes / height);
            const newWidth = Math.floor(width * scale);
            const newHeight = Math.floor(height * scale);
            console.log(`📏 Redimensionando: ${width}x${height} → ${newWidth}x${newHeight}`);
            image.resize(newWidth, newHeight, Jimp.RESIZE_BILINEAR);
            width = newWidth;
            height = newHeight;
        }

        const pixels = [];

        // Processar pixels linha por linha
        console.log('🎨 Processando pixels...');
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = Jimp.intToRGBA(image.getPixelColor(x, y));
                pixels.push([color.r, color.g, color.b]);
            }
        }

        console.log(`✅ Processamento concluído: ${pixels.length} pixels\n`);

        res.json({
            Width: width,
            Height: height,
            Pixels: pixels
        });

    } catch (e) {
        console.error("❌ Erro ao processar imagem:", e.message);
        console.error("Stack trace:", e.stack);
        res.status(500).json({ 
            error: "Failed to load image", 
            details: e.message,
            isDiscordURL: isDiscordURL(url),
            suggestion: isDiscordURL(url) 
                ? "Verifique se a URL está completa com todos os parâmetros (?ex=...&is=...&hm=...)"
                : "Verifique se a URL está acessível e aponta para uma imagem válida."
        });
    }
});

// Rota principal - servir o HTML
app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "Imagem para Roblox.html"));
});

// Endpoint de health check
app.get("/health", (req, res) => {
    res.json({ 
        status: "ok", 
        message: "API está funcionando",
        features: {
            discordSupport: true,
            maxResolution: "configurable",
            formats: ["png", "jpg", "webp", "gif"]
        }
    });
});

// Endpoint de teste para Discord
app.get("/test-discord", async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: "Adicione ?url=<DISCORD_URL>" });
    }
    
    const isDiscord = isDiscordURL(url);
    
    // Tentar baixar para testar
    let downloadTest = "não testado";
    if (isDiscord) {
        try {
            await downloadImage(url);
            downloadTest = "✅ Download funcionou";
        } catch (e) {
            downloadTest = `❌ Download falhou: ${e.message}`;
        }
    }
    
    res.json({
        url: url,
        isDiscordURL: isDiscord,
        downloadTest: downloadTest,
        message: isDiscord 
            ? "✅ Esta é uma URL válida do Discord" 
            : "❌ Esta NÃO é uma URL do Discord"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/parse?url=<URL_DA_IMAGEM>`);
    console.log(`🔷 Suporte a Discord: ATIVO (3 métodos)`);
    console.log(`🧪 Teste Discord: http://localhost:${PORT}/test-discord?url=<URL>`);
    console.log(`${"=".repeat(50)}\n`);
});
