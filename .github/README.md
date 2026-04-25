# @brunoklebewdaw/baileys

Biblioteca WhatsApp Web API modificada baseada no Baileys com suporte para envio de botões interativos.

> [!IMPORTANT]
> Esta biblioteca fork adiciona funções para envio de mensagens com botões (Buttons) que não estão disponíveis na versão original.

## Instalação

```bash
npm install @brunoklebewdaw/baileys
# ou
yarn add @brunoklebewdaw/baileys
```

## Quick Start

### Conectar com QR Code

```typescript
import makeWASocket, { Browsers, useMultiFileAuthState } from '@brunoklebewdaw/baileys'
import pino from 'pino'

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth')
    
    const sock = makeWASocket({
        browser: Browsers.macOS('Desktop'),
        logger: pino().child({ level: 'debug' }),
        printQRInTerminal: true,
        auth: state
    })

    sock.ev.on('creds.update', saveCreds)
    
    sock.ev.on('connection.update', (update) => {
        console.log('Connection update:', update)
    })
    
    return sock
}

connect()
```

### Conectar com Pairing Code

```typescript
import makeWASocket, { useMultiFileAuthState } from '@brunoklebewdaw/baileys'

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth')
    
    const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state
    })

    if (!sock.authState.creds.registered) {
        const phoneNumber = '5511999999999' // Seu número com país
        const code = await sock.requestPairingCode(phoneNumber)
        console.log('Código de pareamento:', code)
    }
    
    sock.ev.on('creds.update', saveCreds)
    
    return sock
}
```

## Enviar Mensagens de Texto

```typescript
// Mensagem simples
await sock.sendMessage(jid, { text: 'Olá!' })

// Com menção
await sock.sendMessage(jid, {
    text: 'Olá @5511999999999!',
    mentions: ['5511999999999@s.whatsapp.net']
})

// Com link preview
await sock.sendMessage(jid, {
    text: 'Acesse https://exemplo.com',
    linkPreview: true
})
```

## Enviar Botões Interativos (Native Flow)

### Tipos de Botões suportados:

- **`reply`** - Botão de resposta rápida
- **`url`** - Botão com URL
- **`call`** - Botão para ligação
- **`copy`** - Botão para copiar código

### Exemplo 1: Botão de Resposta

```typescript
await sock.sendButtonsMessage(jid, {
    text: 'Choose an option:',
    buttons: [
        { 
            type: 'reply', 
            label: 'Option 1', 
            id: 'btn_1' 
        },
        { 
            type: 'reply', 
            label: 'Option 2', 
            id: 'btn_2' 
        }
    ]
})
```

### Exemplo 2: Múltiplos Tipos

```typescript
await sock.sendButtonsMessage(jid, {
    text: 'What would you like to do?',
    buttons: [
        { type: 'reply', label: 'Responder', id: 'btn_reply' },
        { type: 'url', label: 'Visit Site', url: 'https://exemplo.com' },
        { type: 'call', label: 'Call Us', phoneNumber: '+5511999999999' },
        { type: 'copy', label: 'Copy Code', id: 'PROMO2024' }
    ]
})
```

### Exemplo 3: Com Header e Footer

```typescript
await sock.sendButtonsMessage(jid, {
    text: 'Select your payment method:',
    buttons: [
        { type: 'url', label: 'Credit Card', url: 'https://loja.com/cartao' },
        { type: 'url', label: 'PIX', url: 'https://loja.com/pix' },
        { type: 'url', label: 'Boleto', url: 'https://loja.com/boleto' }
    ]
})
```

## Enviar Botões Legacy (Antigo)

O formato legacy usa `sendMessage` diretamente:

```typescript
await sock.sendMessage(jid, {
    text: ' Escolha uma opção:',
    footer: 'Powered by @brunoklebewdaw/baileys',
    buttons: [
        {
            buttonId: 'btn1',
            buttonText: { displayText: 'Option 1' },
            type: 1
        },
        {
            buttonId: 'btn2',
            buttonText: { displayText: 'Option 2' },
            type: 1
        }
    ],
    headerType: 1,
    viewOnce: true
})
```

Ou usando a função helper:

```typescript
await sock.sendButtonsMessageLegacy(jid, {
    text: ' Escolha uma opção:',
    footer: 'Powered by @brunoklebewdaw/baileys',
    buttons: [
        {
            buttonId: 'btn1',
            buttonText: { displayText: 'Option 1' }
        },
        {
            buttonId: 'btn2',
            buttonText: { displayText: 'Option 2' }
        }
    ],
    headerType: 1,
    viewOnce: true
})
```

## Comparação: Native Flow vs Legacy

| Recurso | Native Flow | Legacy |
|--------|-------------|--------|
| Suporte oficial | ✅ Sim | ❌ Deprecated |
| Tipos de botões | reply, url, call, copy | Apenas reply |
| Visual moderno | ✅ Sim | ❌ Não |
| Funciona em grupos | ✅ Sim | ✅ Sim |
| Funciona em canais | ✅ Sim | ❌ Não |

> [!NOTE]
> Recomendamos usar Native Flow (`sendButtonsMessage`) pois o formato legacy foi descontinuado pelo WhatsApp em agosto de 2024.

## Receber Resposta de Botões

```typescript
sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    
    for (const msg of messages) {
        if (msg.message?.buttonsResponseMessage) {
            const response = msg.message.buttonsResponseMessage
            console.log('Button ID:', response.selectedButtonId)
            console.log('Display Text:', response.selectedDisplayText)
            
            // Responder ao clique
            await sock.sendMessage(msg.key.remoteJid!, { 
                text: `Você clicou em: ${response.selectedDisplayText}` 
            })
        }
    }
})
```

## Enviar Mídia

```typescript
// Imagem
await sock.sendMessage(jid, {
    image: { url: 'https://exemplo.com/img.jpg' },
    caption: 'Legenda da imagem'
})

// Vídeo
await sock.sendMessage(jid, {
    video: { url: 'https://exemplo.com/video.mp4' },
    caption: 'Legenda do vídeo'
})

// Áudio
await sock.sendMessage(jid, {
    audio: { url: 'https://exemplo.com/audio.mp3' },
    ptt: true // true para áudio de voz
})

// Sticker
await sock.sendMessage(jid, {
    sticker: { url: 'https://exemplo.com/sticker.webp' }
})

// Documento
await sock.sendMessage(jid, {
    document: { url: 'https://exemplo.com/arquivo.pdf' },
    fileName: 'documento.pdf',
    mimetype: 'application/pdf'
})
```

## Enviar Localização

```typescript
await sock.sendMessage(jid, {
    location: {
        degreesLatitude: -23.550520,
        degreesLongitude: -46.633308,
        name: 'São Paulo, SP'
    }
})
```

## Enviar Contatos

```typescript
await sock.sendMessage(jid, {
    contacts: {
        displayName: 'Contato',
        contacts: [{
            displayName: 'Nome do Contato',
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nTEL:+5511999999999\nEND:VCARD'
        }]
    }
})
```

## Criar Grupo

```typescript
const group = await sock.groupCreate('Nome do Grupo', ['5511999999999@s.whatsapp.net'])
console.log('Group JID:', group.gid)
```

## Adicionar/Remover Participantes

```typescript
// Adicionar
await sock.groupParticipantsUpdate(jid, ['5511999999999@s.whatsapp.net'], 'add')

// Remover
await sock.groupParticipantsUpdate(jid, ['5511999999999@s.whatsapp.net'], 'remove')

// Promover (admin)
await sock.groupParticipantsUpdate(jid, ['5511999999999@s.whatsapp.net'], 'promote')

// Rebaixar (remover admin)
await sock.groupParticipantsUpdate(jid, ['5511999999999@s.whatsapp.net'], 'demote')
```

## Gerenciar Eventos

```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
    console.log('Nova mensagem:', messages)
})

sock.ev.on('message.update', ({ key, update }) => {
    console.log('Mensagem atualizada:', key, update)
})

sock.ev.on('presence.update', ({ id, presences }) => {
    console.log('Presença:', id, presences)
})

sock.ev.on('groups.upsert', (groups) => {
    console.log('Grupos:', groups)
})

sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    console.log('Participante atualizado:', id, participants, action)
})

sock.ev.on('connection.update', (update) => {
    console.log('Conexão:', update)
})
```

## API Completa

### sendButtonsMessage(jid, content, options)

Envia mensagem com botões Native Flow (recomendado).

**Parâmetros:**
- `jid` - JID do destinatário
- `content` - Objeto com:
  - `text` - Texto da mensagem (obrigatório)
  - `buttons` - Array de botões (obrigatório)
    - `type` - 'reply' | 'url' | 'call' | 'copy'
    - `label` - Texto do botão
    - `id` - ID do botão (para reply/copy)
    - `url` - URL (para url)
    - `phoneNumber` - Telefone (para call)
- `options` - Opções adicionais (opicional)

**Retorna:** Message ID

### sendButtonsMessageLegacy(jid, content, options)

Envia mensagem com botões legacy (formato antigo).

**Parâmetros:**
- `jid` - JID do destinatário
- `content` - Objeto com:
  - `text` - Texto da mensagem
  - `footer` - Texto do rodapé
  - `buttons` - Array de botões
    - `buttonId` - ID do botão
    - `buttonText` - { displayText: string }
    - `type` - Tipo do botão (1)
  - `headerType` - Tipo do cabeçalho
  - `viewOnce` - Visualização única
- `options` - Opções adicionais

**Retorna:** Message ID

### generateButtonPayload(content)

Gera o payload de botões para uso personalizado.

**Parâmetros:**
- `content` - Objeto com text e buttons

**Retorna:** Objeto com viewOnceMessage

### generateLegacyButtonsPayload(content)

Gera o payload de botões legacy.

## Exemplos Completos

### Bot com Botões

```typescript
import makeWASocket, { useMultiFileAuthState, Browsers } from '@brunoklebewdaw/baileys'
import pino from 'pino'
import fs from 'fs'

async function main() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth')
    
    const sock = makeWASocket({
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'debug' }),
        printQRInTerminal: true,
        auth: state
    })

    sock.ev.on('creds.update', saveCreds)
    
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        
        for (const msg of messages) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
            
            if (text === 'menu') {
                await sock.sendButtonsMessage(msg.key.remoteJid!, {
                    text: 'Selecione uma opção:',
                    buttons: [
                        { type: 'reply', label: 'Informações', id: 'info' },
                        { type: 'reply', label: 'Suporte', id: 'support' },
                        { type: 'url', label: 'Website', url: 'https://exemplo.com' },
                        { type: 'call', label: 'Falar atendente', phoneNumber: '+5511999999999' }
                    ]
                })
            }
            
            if (msg.message?.buttonsResponseMessage) {
                const response = msg.message.buttonsResponseMessage
                const buttonId = response.selectedButtonId
                
                if (buttonId === 'info') {
                    await sock.sendMessage(msg.key.remoteJid!, {
                        text: 'Somos uma empresa especializada em soluções WhatsApp.'
                    })
                }
            }
        }
    })
    
    console.log('Bot iniciado!')
}

main()
```

### Servidor Express com API

```typescript
import express from 'express'
import makeWASocket, { useMultiFileAuthState, Browsers } from '@brunoklebewdaw/baileys'

const app = express()
app.use(express.json())

let sock

async function initBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth')
    
    sock = makeWASocket({
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: true,
        auth: state
    })

    sock.ev.on('creds.update', saveCreds)
}

app.post('/send-buttons', async (req, res) => {
    const { jid, text, buttons } = req.body
    
    try {
        const messageId = await sock.sendButtonsMessage(jid, {
            text,
            buttons
        })
        res.json({ success: true, messageId })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

app.post('/send-message', async (req, res) => {
    const { jid, text } = req.body
    
    try {
        await sock.sendMessage(jid, { text })
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

await initBot()
app.listen(3000, () => console.log('API running on port 3000'))
```

## Troubleshooting

### Botão não aparece
- O WhatsApp retirou suporte a botões legacy em agosto 2024
- Use `sendButtonsMessage` (Native Flow) para melhores resultados

### Erro de autenticação
- Verifique se a pasta `auth` tem as credenciais corretas
- Delete a pasta `auth` e escaneie o QR code novamente

### "Device not linked"
- Execute o script novamente e escaneie o QR code
- As sessões expiram após alguns dias sem uso

## Licença

MIT License - Livre para uso comercial e pessoal.
