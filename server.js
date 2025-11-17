import express from "express";
import cors from "cors";
import Jimp from "jimp";

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint para processar imagens de URLs
app.get("/parse", async (req, res) => {
    const url = req.query.url;
    const maxRes = parseInt(req.query.maxRes) || 0; // Resolução máxima opcional
    
    if (!url) {
        return res.status(400).json({ error: "Missing ?url=" });
    }

    try {
        // Carregar imagem da URL
        const image = await Jimp.read(url);

        let width = image.bitmap.width;
        let height = image.bitmap.height;

        // Aplicar resolução máxima se especificada
        if (maxRes > 0 && (width > maxRes || height > maxRes)) {
            const scale = Math.min(maxRes / width, maxRes / height);
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
            image.resize(width, height, Jimp.RESIZE_BILINEAR);
        }

        const pixels = [];

        // Processar pixels linha por linha (ordem correta para Roblox)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = Jimp.intToRGBA(image.getPixelColor(x, y));
                pixels.push([color.r, color.g, color.b]);
            }
        }

        res.json({
            Width: width,
            Height: height,
            Pixels: pixels
        });

    } catch (e) {
        console.error("Erro ao processar imagem:", e);
        res.status(500).json({ 
            error: "Failed to load image", 
            details: e.toString(),
            message: "Não foi possível carregar a imagem. Verifique se a URL está acessível."
        });
    }
});

// Endpoint de health check
app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "API está funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API rodando na porta ${PORT}`);
    console.log(`📡 Endpoint: http://localhost:${PORT}/parse?url=<URL_DA_IMAGEM>`);
});
