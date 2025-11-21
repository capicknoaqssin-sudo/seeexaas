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
app.use(express.static(__dirname));

// ================= CONFIGURAÇÕES DE SEGURANÇA =================
const MAX_BUFFER_SIZE = 8 * 1024 * 1024; // 8MB
const MAX_PIXELS = 500000; // limite seguro de pixels
const MAX_DIMENSION = 800; // tamanho máximo por lado

// =============================================================

function isDiscordURL(url) {
    if (!url || typeof url !== 'string') return false;
    return /discordapp\.com/i.test(url) || 
           /cdn\.discordapp\.com/i.test(url) || 
           /discord\.com/i.test(url) ||
           /media\.discordapp\.net/i.test(url);
}

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const options = {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        };

        protocol.get(url, options, (response) => {
            if ([301, 302].includes(response.statusCode)) {
                return downloadImage(response.headers.location)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                return reject(new Error(`HTTP ${response.statusCode}`));
            }

            let total = 0;
            const chunks = [];

            response.on('data', (chunk) => {
                total += chunk.length;
                if (total > MAX_BUFFER_SIZE) {
                    reject(new Error('Imagem excede 8MB'));
                    response.destroy();
                    return;
                }
                chunks.push(chunk);
            });

            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

async function loadImageSmart(url) {
    if (isDiscordURL(url)) {
        const buffer = await downloadImage(url);
        return await Jimp.read(buffer);
    } else {
        return await Jimp.read(url);
    }
}

app.get('/parse', async (req, res) => {
    let url = req.query.url;
    const maxRes = parseInt(req.query.maxRes) || MAX_DIMENSION;

    if (!url) {
        return res.status(400).json({ error: 'Parametro ?url= ausente' });
    }

    try {
        console.log('📥 Processando:', url);
        let image = await loadImageSmart(url);

        let width = image.bitmap.width;
        let height = image.bitmap.height;

        // Limitar dimensão
        if (width > maxRes || height > maxRes) {
            const scale = Math.min(maxRes / width, maxRes / height);
            image.resize(Math.floor(width * scale), Math.floor(height * scale));
            width = image.bitmap.width;
            height = image.bitmap.height;
        }

        // Limitar pixels totais
        if (width * height > MAX_PIXELS) {
            const scale = Math.sqrt(MAX_PIXELS / (width * height));
            image.resize(Math.floor(width * scale), Math.floor(height * scale));
            width = image.bitmap.width;
            height = image.bitmap.height;
        }

        console.log(`✅ Dimensões finais: ${width}x${height}`);

        const totalPixels = width * height;
        const pixels = new Array(totalPixels);
        let i = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(x, y));
                pixels[i++] = [r, g, b];
            }
        }

        res.json({
            Width: width,
            Height: height,
            Pixels: pixels
        });

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
            maxBufferMB: 8,
            maxPixels: MAX_PIXELS,
            maxResolution: MAX_DIMENSION
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('========================================');
    console.log(`🚀 Servidor seguro rodando na porta ${PORT}`);
    console.log(`🌐 API: /parse?url=`);
    console.log('🛡️ Proteção contra travamento ATIVA');
    console.log('========================================');
});
