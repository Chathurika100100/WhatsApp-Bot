const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

// Railway එකේ දාන SESSION_ID එකෙන් Session දත්ත හදාගන්නා කොටස
if (process.env.SESSION_ID && !fs.existsSync('auth_info_baileys')) {
    console.log("Session එක සකසමින් පවතී...");
    const sessionData = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
    fs.mkdirSync('auth_info_baileys', { recursive: true });
    fs.writeFileSync('auth_info_baileys/creds.json', sessionData);
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // සර්වර් එකේ දුවන නිසා QR එකක් පෙන්වීම අවශ්‍ය නැත
        logger: pino({ level: 'silent' }),
        browser: ["Remote Downloader", "Safari", "3.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp Bot එක සාර්ථකව සම්බන්ධ වුනා! ✅');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // මැසේජ් වලට ප්‍රතිචාර දැක්වීම සහ ෆයිල් යැවීමේ කොටස
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // .sg කමාන්ඩ් එක ක්‍රියාත්මක වීම
        if (text.startsWith('.sg')) {
            const regex = /\[([^\]]+)\]/g;
            let matches = [];
            let match;
            while ((match = regex.exec(text)) !== null) matches.push(match[1].trim());

            if (matches.length < 2) {
                await sock.sendMessage(msg.key.remoteJid, { text: "❌ Format එක වැරදියි. මෙලෙස එවන්න: \n `.sg [Group Name] [Link]`" });
                return;
            }

            const targetGroupName = matches[0];
            const links = matches.slice(1);

            const allGroups = await sock.groupFetchAllParticipating();
            let targetGroupJid = Object.keys(allGroups).find(jid => allGroups[jid].subject.toLowerCase() === targetGroupName.toLowerCase());

            if (!targetGroupJid) {
                await sock.sendMessage(msg.key.remoteJid, { text: `❌ '${targetGroupName}' නමින් Group එකක් හමු වුනේ නැත!` });
                return;
            }

            await sock.sendMessage(msg.key.remoteJid, { text: "⏳ ලිපිගොනු බාගත වෙමින් පවතී. කරුණාකර රැඳී සිටින්න..." });

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
                    await sock.sendMessage(msg.key.remoteJid, { text: `✅ ${filename} සාර්ථකව යවන ලදී!` });
                } catch (e) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${link} බාගත කිරීමට නොහැකි විය.` });
                }
            }
        }
    });
}

connectToWhatsApp();
