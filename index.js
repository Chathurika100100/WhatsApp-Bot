const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Session ID එක ෆයිල් එකක් බවට පත් කිරීම
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        JSON.parse(decryptedCreds); 
        fs.writeFileSync('./session/creds.json', decryptedCreds);
    } catch (e) {
        fs.writeFileSync('./session/creds.json', process.env.SESSION_ID);
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`සම්බන්ධතාවය බිඳ වැටුණා (Status: ${statusCode}). නැවත උත්සාහ කරයි...`, shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;

        // 1. MENU COMMAND (.menu)
        if (text === '.menu') {
            const menuText = `🤖 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙱𝙾𝚃* 🤖\n\n` +
                             `👋 ආයුබෝවන්! මෙන්න මගේ විධානයන් (Commands) ලැයිස්තුව:\n\n` +
                             `⚙️ *ප්‍රධාන විධානයන්:*\n` +
                             `👉 📄 \`.menu\` - මෙම මෙනුව ලබා ගැනීමට.\n` +
                             `👉 ⚡ \`.speed\` - සර්වර් එකේ වේගය (Speed Test) බැලීමට.\n` +
                             `👉 📥 \`.sg [GroupName] [Link1] [Link2]\` - ලින්ක් මඟින් ගොනු ඩවුන්ලෝඩ් කර අදාළ සමූහයට යැවීමට.\n\n` +
                             `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;
                             
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            return;
        }

        // 2. SPEED TEST COMMAND (.speed) [Mbps වලින් පෙන්වීමට අප්ඩේට් කරන ලදී]
        if (text === '.speed') {
            await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී, කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });
            
            try {
                const pingStart = performance.now();
                await axios.get('https://www.google.com');
                const ping = (performance.now() - pingStart).toFixed(0);

                // Download වේගය මැනීම සහ Mbps වලට හැරවීම (MB/s * 8)
                const dlStart = performance.now();
                await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer' });
                const dlEnd = performance.now();
                const dlTime = (dlEnd - dlStart) / 1000; 
                const downloadSpeed = ((1 / dlTime) * 8).toFixed(2); 

                // Upload වේගය මැනීම සහ Mbps වලට හැරවීම (MB/s * 8)
                const ulStart = performance.now();
                const dummyBuffer = Buffer.alloc(104857
