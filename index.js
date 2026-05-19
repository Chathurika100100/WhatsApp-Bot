import 'dotenv/config'; 
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import speedTest from 'speedtest-net';
import fs from 'fs';
import http from 'http'; 

// 🌐 Railway එකට බොට් ක්‍රියාත්මක බව පෙන්වීමට සහ Restart වීම වැළැක්වීමට ඇති Web Server එක
const server = http.createServer((req, res) => {
    res.end('WhatsApp Bot is Online and Running Successfully!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server is running on port ${PORT}`);
});

async function startBot() {
    // සෙෂන් එක සේව් වෙන්නේ 'bot_session' කියන ෆෝල්ඩර් එකේ
    const { state, saveCreds } = await useMultiFileAuthState('bot_session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: ['Ubuntu', 'Chrome', '22.04.4'] 
    });

    // 🔑 Pairing Code ලබා ගැනීම (සම්පූර්ණයෙන්ම Variable එක හරහා)
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER; 
        
        if (!phoneNumber) {
            console.error("\n❌ ERROR: PHONE_NUMBER Variable එක Railway එකේ දාලා නැහැ! කරුණාකර ඒක එකතු කරන්න.\n");
            process.exit(1);
        }
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber.trim());
                console.log(`\n=========================================================`);
                console.log(`🔑 ඔයාගේ අලුත් PAIRING CODE එක: ${code}`);
                console.log(`=========================================================\n`);
            } catch (error) {
                console.error('❌ Pairing code Error:', error.message);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    // 📩 සියලුම Commands හැසිරවීම
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return; // හැම කcommand එකක්ම පටන් ගන්නේ තිතකින් (.)

        const senderJid = msg.key.participant || msg.key.remoteJid; 
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex) || [];

        // 1️⃣ .si Command (Direct Download to Inbox)
        if (text.startsWith('.si ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .si [link]' }, { quoted: msg });
            
            await sock.sendMessage(msg.key.remoteJid, { text: '📥 ලින්ක්ස් ඩවුන්ලෝඩ් වෙමින් පවතී. කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });

            for (let url of urls) {
                try {
                    await sock.sendMessage(senderJid, { 
                        document: { url: url }, 
                        mimetype: 'application/octet-stream', 
                        fileName: 'downloaded_file' 
                    });
                    if (isGroup) await sock.sendMessage(msg.key.remoteJid, { text: '✅ ෆයිල් එක ඔයාගේ Inbox එකට එව්වා!' }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ මේ ලින්ක් එකෙන් ෆයිල් එක ගන්න බැරි වුණා: ${url}` }, { quoted: msg });
                }
            }
        }

        // 2️⃣ .sg Command (Direct Download to Specified Group)
        else if (text.startsWith('.sg ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .sg Group Name [link]' }, { quoted: msg });

            let groupName = text.replace('.sg ', '');
            urls.forEach(u => groupName = groupName.replace(u, ''));
            groupName = groupName.trim().toLowerCase();

            if (!groupName) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර Group එකේ නම ඇතුළත් කරන්න.' }, { quoted: msg });

            await sock.sendMessage(msg.key.remoteJid, { text: `🔍 '${groupName}' ගෲප් එක හොයමින් පවතී...` });

            try {
                const groups = await sock.groupFetchAllParticipating();
                let targetGroupJid = null;

                for (let jid in groups) {
                    if (groups[jid].subject.toLowerCase() === groupName) {
                        targetGroupJid = jid;
                        break;
                    }
                }

                if (!targetGroupJid) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ ඒ නමින් Group එකක් හොයාගන්න බැරි වුණා. බොට් ඒ ගෲප් එකේ ඉන්නවද බලන්න.' });

                await sock.sendMessage(msg.key.remoteJid, { text: `✅ Group එක හොයාගත්තා. ෆයිල්ස් යවමින් පවතී...` });

                for (let url of urls) {
                    await sock.sendMessage(targetGroupJid, { 
                        document: { url: url }, 
                        mimetype: 'application/octet-stream', 
                        fileName: 'group_downloaded_file' 
                    });
                }
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Group එකට යවනකොට දෝෂයක් ආවා.' });
            }
        }

        // 3️⃣ .speed Command (Check Server Speed)
        else if (text.trim() === '.speed') {
            await sock.sendMessage(msg.key.remoteJid, { text: '🚀 වේගය පරීක්ෂා කරමින් පවතී. තත්පර කිහිපයක් රැඳී සිටින්න...' }, { quoted: msg });
            const startPing = Date.now();
            try {
                const speed = await speedTest({ acceptLicense: true, acceptGdpr: true });
                const pingTime = Date.now() - startPing;
                const downloadSpeed = (speed.download.bandwidth / 125000).toFixed(2); 
                const uploadSpeed = (speed.upload.bandwidth / 125000).toFixed(2);     

                const speedText = `*⚡ Speed Test Results*\n\n` +
                                  `🏓 Ping: ${pingTime} ms\n` +
                                  `⬇️ Download: ${downloadSpeed} Mbps\n` +
                                  `⬆️ Upload: ${uploadSpeed} Mbps\n` +
                                  `🌍 Server: ${speed.server.name}, ${speed.server.location}`;
                await sock.sendMessage(msg.key.remoteJid, { text: speedText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Speed test එක මේ වෙලාවේ වැඩ කරන්නේ නැහැ. සර්වර් දෝෂයක්.' }, { quoted: msg });
            }
        }

        // 4️⃣ .menu Command (Display All Commands)
        else if (text.trim() === '.menu') {
            const menuText = `*🤖 WhatsApp Downloader Bot Menu*\n\n` +
                             `*1. .si [links]*\n` +
                             `> ලින්ක් එකෙන් ෆයිල් ඩවුන්ලෝඩ් කරලා ඔයාගේ Inbox එකටම එවයි.\n\n` +
                             `*2. .sg [group name] [links]*\n` +
                             `> ලින්ක් එකෙන් ෆයිල් ඩවුන්ලෝඩ් කරලා ඔයා කියන Group එකට යවයි.\n\n` +
                             `*3. .speed*\n` +
                             `> බොට් සර්වර් එකේ Ping එක සහ ඉන්ටර්නෙට් වේගය පෙන්නයි.\n\n` +
                             `*4. .menu*\n` +
                             `> මේ කමාන්ඩ් මෙනු එක නැවත ලබාදෙයි.`;
            await sock.sendMessage(msg.key.remoteJid, { text: menuText }, { quoted: msg });
        }
    });

    // 🔄 Connection එක විසන්ධි වුවහොත් නැවත සම්බන්ධ කිරීම
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Connection closed. Reconnecting...`);
            
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000); 
            } else {
                console.log('❌ Session එක ලොග් අවුට් වී ඇත. පැරණි දත්ත මකා නැවත ක්‍රියාත්මක වේ...');
                fs.rmSync('./bot_session', { recursive: true, force: true });
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 WhatsApp Bot successfully connected and fully functional!');
        }
    });
}

startBot();
