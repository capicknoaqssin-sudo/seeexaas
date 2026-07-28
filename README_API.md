# 🚀 API de Extração Universal de Imagens para Roblox

API Node.js otimizada para extrair e converter imagens de **qualquer site** (Discord, Imgur, Tenor, Pinterest, Google, Base64, etc.) para o formato JSON do Roblox.

## 📋 Requisitos

- Node.js 18+ instalado
- npm ou yarn

## 🚀 Instalação e Execução

1. **Instale as dependências:**
```bash
npm install
```

2. **Inicie a API:**
```bash
node server.js
```

A API estará rodando em `http://localhost:3000`

---

## 📡 Endpoints

### 1. `GET /parse`
Processa uma imagem de qualquer URL ou string Base64.

**Parâmetros (Query):**
- `url` (obrigatório): Link da imagem, link de página (ex: Imgur/Pinterest) ou string Base64.
- `maxRes` (opcional): Resolução máxima por lado (Padrão: 800).

**Exemplo:**
```
GET http://localhost:3000/parse?url=https://cdn.discordapp.com/attachments/1234/5678/image.png
```

---

### 2. `POST /parse`
Ideal para enviar imagens em Base64 ou URLs longas sem limite de tamanho no cabeçalho.

**Corpo (JSON):**
```json
{
  "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "maxRes": 800
}
```

---

### Resposta Padrão da API:
```json
{
  "Width": 128,
  "Height": 128,
  "Pixels": [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255]
  ]
}
```

---

## 🛡️ Melhorias da Versão Universal

- ✅ **Suporte Total ao Discord**: Trata links expirados, `cdn.discordapp.com`, `media.discordapp.net` e proxies de preview do Discord.
- ✅ **Extração de Páginas Web (OpenGraph)**: Se você colar um link de página (ex: Imgur, Tenor, Pinterest), a API extrai automaticamente a imagem real (`og:image` / `twitter:image`).
- ✅ **Bypass de Bloqueios (User-Agent Chrome)**: Envia cabeçalhos completos de navegador Chrome real para evitar erros HTTP 403 Forbidden ou bloqueios da Cloudflare.
- ✅ **Suporte a Base64 e Data URLs**: Suporta URLs no formato `data:image/png;base64,...` ou Base64 pura.
- ✅ **Tratamento de Redirecionamentos e Timeout**: Suporta múltiplos redirecionamentos HTTP(S) automáticos com limite de tempo de 15s para não travar.
