import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import 'dotenv/config';
import axios from 'axios';
import speedTest from 'speedtest-net';
import fs from 'fs';
import path from 'path';

// 📂 Session ID එකෙන් ලොගින් ෆයිල්ස් ටික නැවත සකස් කරන Function එක
function restoreSession() {
    const sessionId = process.env.SESSION_ID;
    if (!sessionId) {
        console.error("ERROR: SESSION_ID is missing in Environment Variables!");
        process.exit(1);
    }

    const authFolder = './auth_info_baileys';
    
    // ෆෝල්ඩර් එක නැත්නම් හදනවා
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const credsPath = path.join(authFolder, 'creds.json');

    // creds.json එක දැනටමත් නැත්නම් විතරක් Session ID එකෙන් හදනවා
    if (!fs.existsSync(credsPath)) {
        try {
            console.log("Restoring session from SESSION_ID...");
            
            // සමහර බොට්ස් වල Session ID එක මැදට යනකම් විවිධ prefixes තියෙනවා (උදා: Session;;; හෝ BotName~)
            // ඒ නිසා Base64 කොටස විතරක් වෙන් කරගන්නවා
            let base64String = sessionId;
            if (sessionId.includes(';;;')) base64String = sessionId.split(';;;').pop();
            else if (sessionId.includes('~')) base64String = sessionId.split('~').pop();
            else if (sessionId.includes(':')) base64String = sessionId.split(':').pop();

            // Base64 Text එක සාමාන්‍ය JSON එකකට Decode කිරීම
            const decrypted = Buffer.from(base64String, 'base64').toString('utf-8');
            
            // creds.json ෆයිල් එක ලෙස Save කිරීම
            fs.writeFileSync(credsPath, decrypted);
            console.log("✅ Session Credentials successfully restored!");
        } catch (err) {
            console.error("❌ Failed to decode SESSION_ID. Please check if your Session ID is valid.", err);
            process.exit(1);
        }
    }
}

async function startBot() {
    // බොට් පටන් ගන්න කලින් Session එක restore කරගන්නවා
    restoreSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // සෙෂන් ID එක තියෙන නිසා QR පෙන්වන්න ඕන නෑ
    });

    sock.ev.on('creds.update', saveCreds);

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
            if (urls.length === 0) {
                return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .si [link]' }, { quoted: msg });
            }
            await sock.sendMessage(msg.key.remoteJid, { text: '📥 Links ඩවුන්ලෝඩ් වෙමින් පවතී. කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });

            for (let url of urls) {
                try {
                    await sock.sendMessage(senderJid, { 
                        document: { url: url }, 
                        mimetype: 'application/octet-stream', 
                        fileName: 'downloaded_file' 
                    });
                    if (isGroup) {
                         await sock.sendMessage(msg.key.remoteJid, { text: '✅ ෆයිල් එක ඔයාගේ Inbox එකට එව්වා!' }, { quoted: msg });
                    }
                } catch (error) {
                    await sock.sendMessage(senderJid, { text: `❌ මේ ලින්ක් එකෙන් ෆයිල් එක ගන්න බැරි වුණා: ${url}` });
                }
            }
        }

        // 2. .sg Command
        else if (text.startsWith('.sg ')) {
            if (urls.length === 0) {
                return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .sg Group Name [link]' }, { quoted: msg });
            }

            let groupName = text.replace('.sg ', '');
            urls.forEach(u => groupName = groupName.replace(u, ''));
            groupName = groupName.trim().toLowerCase();

            if (!groupName) {
                return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර Group එකේ නම ඇතුළත් කරන්න.' }, { quoted: msg });
            }

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

                if (!targetGroupJid) {
                    return await sock.sendMessage(msg.key.remoteJid, { text: '❌ ඒ නමින් Group එකක් හොයාගන්න බැරි වුණා. බොට් ඒ ගෲප් එකේ ඉන්නවද බලන්න.' });
                }

                await sock.sendMessage(msg.key.remoteJid, { text: `✅ Group එක හොයාගත්තා. ෆයිල්ස් යවමින් පවතී...` });

                for (let url of urls) {
                    await sock.sendMessage(targetGroupJid, { 
                        document: { url: url }, 
                        mimetype: 'application/octet-stream', 
                        fileName: 'group_downloaded_file' 
                    });
                }
            } catch (error) {
                console.error(error);
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Group එකට යවනකොට දෝෂයක් ආවා.' });
            }
        }

        // 3. .speed Command
        else if (text.trim() === '.speed') {
            await sock.sendMessage(msg.key.remoteJid, { text: '🚀 Speed එක පරීක්ෂා කරමින් පවතී. තත්පර කිහිපයක් රැඳී සිටින්න...' }, { quoted: msg });
            
            const startPing = Date.now();
            try {
                const speed = await speedTest({ acceptLicense: true, acceptGdpr: true });
                const endPing = Date.now();
                const pingTime = endPing - startPing;

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

        // 4. .menu Command
        else if (text.trim() === '.menu') {
            const menuText = `*🤖 WhatsApp Downloader Bot Menu*\n\n` +
                             `*1. .si [links]*\n` +
                             `> ලින්ක්ස් වලින් ෆයිල් ඩවුන්ලෝඩ් කරලා ඔයාගේ Inbox එකටම එවයි.\n\n` +
                             `*2. .sg [group name] [links]*\n` +
                             `> අදාළ ලින්ක්ස් වලින් ෆයිල් ඩවුන්ලෝඩ් කරලා ඔයා කියන Group එකට යවයි.\n\n` +
                             `*3. .speed*\n` +
                             `> බොට් ඉන්න Server එකේ Ping එක, Download/Upload වේගය පෙන්නයි.\n\n` +
                             `*4. .menu*\n` +
                             `> මේ මෙනු එක පෙන්නයි.`;
                             
            await sock.sendMessage(msg.key.remoteJid, { text: menuText }, { quoted: msg });
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('🎉 WhatsApp Bot is successfully connected and authenticated!');
        }
    });
}

startBot();
