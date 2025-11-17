# 🚀 API de Processamento de Imagens para Roblox

API Node.js que processa imagens de URLs e converte para o formato JSON usado no Roblox.

## 📋 Requisitos

- Node.js 18+ instalado
- npm ou yarn

## 🚀 Instalação

1. **Instale as dependências:**
```bash
npm install
```

2. **Inicie a API:**
```bash
node server.js
```

A API estará rodando em `http://localhost:3000`

## 📡 Endpoints

### GET `/parse`
Processa uma imagem de uma URL e retorna dados no formato JSON do Roblox.

**Parâmetros:**
- `url` (obrigatório): URL da imagem a ser processada
- `maxRes` (opcional): Resolução máxima (ex: 2048)

**Exemplo:**
```
GET http://localhost:3000/parse?url=https://exemplo.com/imagem.png&maxRes=2048
```

**Resposta:**
```json
{
  "Width": 128,
  "Height": 128,
  "Pixels": [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255]
    // ... mais pixels
  ]
}
```

### GET `/health`
Verifica se a API está funcionando.

**Exemplo:**
```
GET http://localhost:3000/health
```

**Resposta:**
```json
{
  "status": "ok",
  "message": "API está funcionando"
}
```

## 💻 Como Usar

### Via Navegador
Abra o arquivo `Imagem para Roblox.html` no navegador e cole um link de imagem. A API será usada automaticamente.

### Via cURL
```bash
curl "http://localhost:3000/parse?url=https://exemplo.com/imagem.png"
```

### Via JavaScript
```javascript
const response = await fetch('http://localhost:3000/parse?url=https://exemplo.com/imagem.png');
const data = await response.json();
console.log(data);
```

## 📦 Dependências

- `express`: Framework web
- `cors`: Middleware para CORS
- `jimp`: Processamento de imagens

## ⚙️ Configuração

A porta padrão é `3000`. Para alterar, defina a variável de ambiente `PORT`:

```bash
PORT=8080 node server.js
```

## 🔧 Funcionalidades

- ✅ Processa imagens de qualquer URL
- ✅ Suporta múltiplos formatos (PNG, JPG, GIF, WebP, etc.)
- ✅ Redimensionamento automático
- ✅ Resolve problemas de CORS
- ✅ Processamento rápido no servidor

## 📄 Licença

MIT

