const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

// --- Session එක String එකකින් හදාගන්නා කොටස ---
if (process.env.SESSION_ID && !fs.existsSync('auth_info_baileys')) {
    console.log("Session ID එකෙන් දත්ත ලබා ගනිමින්...");
    const sessionData = Buffer.from(process.env.SESSION_ID, 'base64').toString();
    fs.mkdirSync('auth_info_baileys', { recursive: true });
    // මෙතනදී සරලවම creds.json එක පමණක් සෑදීම (Baileys සඳහා ප්‍රමාණවත් වේ)
    fs.writeFileSync('auth_info_baileys/creds.json', sessionData);
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Remote Downloader", "Safari", "3.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp Bot එක සාර්ථකව සම්බන්ධ වුනා! ✅');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (text.startsWith('.sg')) {
            const regex = /\[([^\]]+)\]/g;
            let matches = [];
            let match;
            while ((match = regex.exec(text)) !== null) matches.push(match[1].trim());

            if (matches.length < 2) {
                await sock.sendMessage(msg.key.remoteJid, { text: "❌ Format: `.sg [Group Name] [Link]`" });
                return;
            }

            const targetGroupName = matches[0];
            const links = matches.slice(1);
            const allGroups = await sock.groupFetchAllParticipating();
            let targetGroupJid = Object.keys(allGroups).find(jid => allGroups[jid].subject.toLowerCase() === targetGroupName.toLowerCase());

            if (!targetGroupJid) {
                await sock.sendMessage(msg.key.remoteJid, { text: "❌ Group එක හමු වුනේ නැත!" });
                return;
            }

            for (const link of links) {
                try {
                    let filename = path.basename(new URL(link).pathname) || `file_${Date.now()}`;
                    const response = await axios.get(link, { responseType: 'arraybuffer' });
                    const fileBuffer = Buffer.from(response.data);
                    await sock.sendMessage(targetGroupJid, {
                        document: fileBuffer,
                        mimetype: mime.lookup(filename) || 'application/octet-stream',
                        fileName: decodeURIComponent(filename)
                    });
                } catch (e) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${link}` });
                }
            }
        }
    });
}

connectToWhatsApp();