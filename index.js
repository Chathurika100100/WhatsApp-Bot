import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import speedTest from 'speedtest-net';
import fs from 'fs';
import http from 'http'; // අලුතින් එකතු කළා

// 🌐 Railway එකට බොට් ක්‍රියාත්මක බව පෙන්වීමට පොඩි Server එකක්
const server = http.createServer((req, res) => {
    res.end('WhatsApp Bot is Online and Running!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server is running on port ${PORT}`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('bot_session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: ['Ubuntu', 'Chrome', '22.04.4'] 
    });

    // 🔑 Pairing Code ඉල්ලීම
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94726046800"; // ඔයාගේ WhatsApp අංකය
        
        // තත්පර 5ක් ඉඳලා එක පාරක් විතරක් කෝඩ් එක ගන්නවා
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n=========================================================`);
                console.log(`🔑 ඔයාගේ අලුත් PAIRING CODE එක: ${code}`);
                console.log(`=========================================================\n`);
            } catch (error) {
                console.error('❌ Pairing code Error:', error.message);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    // 📩 මැසේජ් හැසිරවීම (Commands)
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return; 

        const senderJid = msg.key.participant || msg.key.remoteJid; 
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex) || [];

        // 1. .si Command
        if (text.startsWith('.si ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .si [link]' }, { quoted: msg });
            
            await sock.sendMessage(msg.key.remoteJid, { text: '📥 ලින්ක්ස් ඩවුන්ලෝඩ් වෙමින් පවතී. කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });

            for (let url of urls) {
                try {
                    await sock.sendMessage(senderJid, { document: { url: url }, mimetype: 'application/octet-stream', fileName: 'downloaded_file' });
                    if (isGroup) await sock.sendMessage(msg.key.remoteJid, { text: '✅ ෆයිල් එක ඔයාගේ Inbox එකට එව්වා!' }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(senderJid, { text: `❌ මේ ලින්ක් එකෙන් ෆයිල් එක ගන්න බැරි වුණා: ${url}` });
                }
            }
        }

        // 2. .sg Command
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

                if (!targetGroupJid) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ ඒ නමින් Group එකක් හොයාගන්න බැරි වුණා.' });

                await sock.sendMessage(msg.key.remoteJid, { text: `✅ Group එක හොයාගත්තා. ෆයිල්ස් යවමින් පවතී...` });

                for (let url of urls) {
                    await sock.sendMessage(targetGroupJid, { document: { url: url }, mimetype: 'application/octet-stream', fileName: 'group_downloaded_file' });
                }
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Group එකට යවනකොට දෝෂයක් ආවා.' });
            }
        }

        // 3. .speed Command
        else if (text.trim() === '.speed') {
            await sock.sendMessage(msg.key.remoteJid, { text: '🚀 වේගය පරීක්ෂා කරමින් පවතී...' }, { quoted: msg });
            const startPing = Date.now();
            try {
                const speed = await speedTest({ acceptLicense: true, acceptGdpr: true });
                const pingTime = Date.now() - startPing;
                const downloadSpeed = (speed.download.bandwidth / 125000).toFixed(2); 
                const uploadSpeed = (speed.upload.bandwidth / 125000).toFixed(2);     

                const speedText = `*⚡ Speed Test Results*\n\n🏓 Ping: ${pingTime} ms\n⬇️ Download: ${downloadSpeed} Mbps\n⬆️ Upload: ${uploadSpeed} Mbps\n🌍 Server: ${speed.server.name}, ${speed.server.location}`;
                await sock.sendMessage(msg.key.remoteJid, { text: speedText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Speed test එක මේ වෙලාවේ වැඩ කරන්නේ නැහැ.' }, { quoted: msg });
            }
        }

        // 4. .menu Command
        else if (text.trim() === '.menu') {
            const menuText = `*🤖 WhatsApp Downloader Bot Menu*\n\n*1. .si [links]*\n> Inbox එකට ඩවුන්ලෝඩ් කරයි.\n\n*2. .sg [group name] [links]*\n> Group එකට යවයි.\n\n*3. .speed*\n> වේගය පරීක්ෂා කරයි.\n\n*4. .menu*\n> මෙනු එක පෙන්නයි.`;
            await sock.sendMessage(msg.key.remoteJid, { text: menuText }, { quoted: msg });
        }
    });

    // 🔄 Connection හැසිරවීම
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Connection closed. Reconnecting...`);
            
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000); 
            } else {
                console.log('❌ Session එක ලොග් අවුට් වී ඇත. කරුණාකර ෆෝල්ඩරය මකා නැවත උත්සාහ කරන්න.');
                fs.rmSync('./bot_session', { recursive: true, force: true });
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 WhatsApp Bot successfully connected!');
        }
    });
}

startBot();
