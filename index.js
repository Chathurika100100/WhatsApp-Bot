import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import 'dotenv/config';
import axios from 'axios';
import speedTest from 'speedtest-net';
import fs from 'fs';
import path from 'path';

// 📂 Session ID එක පරීක්ෂා කර Decode කරන Function එක
function restoreSession() {
    const sessionId = process.env.SESSION_ID;
    if (!sessionId) {
        console.error("❌ ERROR: SESSION_ID is missing in Environment Variables!");
        process.exit(1);
    }

    const authFolder = './auth_info_baileys';

    // 🛑 පැරණි සෙෂන් එක සර්වර් එකෙන් මකා දැමීම (අලුත් Session ID එක වැඩ කරන්න මේක අනිවාර්යයි)
    if (fs.existsSync(authFolder)) {
        console.log("🗑️ පැරණි සෙෂන් දත්ත මකා දමමින් පවතී...");
        fs.rmSync(authFolder, { recursive: true, force: true });
    }
    
    // අලුත් ෆෝල්ඩර් එකක් සෑදීම
    fs.mkdirSync(authFolder, { recursive: true });
    const credsPath = path.join(authFolder, 'creds.json');

    try {
        console.log("🔄 අලුත් SESSION_ID එකෙන් සෙෂන් එක සකස් කරමින් පවතී...");
        
        let base64String = sessionId;
        if (sessionId.includes(';;;')) base64String = sessionId.split(';;;').pop();
        else if (sessionId.includes('~')) base64String = sessionId.split('~').pop();
        else if (sessionId.includes(':')) base64String = sessionId.split(':').pop();

        const decrypted = Buffer.from(base64String, 'base64').toString('utf-8');
        
        // JSON එක නිවැරදිදැයි පරීක්ෂා කිරීම
        JSON.parse(decrypted); 
        
        fs.writeFileSync(credsPath, decrypted);
        console.log("✅ Hosa Session Credentials successfully restored!");
    } catch (err) {
        console.error("❌ ERROR: ඔයාගේ SESSION_ID එක වැරදියි හෝ බිඳී ඇත!");
        process.exit(1); 
    }
}

async function startBot() {
    // බොට් පටන් ගන්න කලින් පැරණි සෙෂන් මකලා අලුත් එක දානවා
    restoreSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '22.04.4'] 
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
            await sock.sendMessage(msg.key.remoteJid, { text: '📥 ලින්ක්ස් ඩවුන්ලෝඩ් වෙමින් පවතී. කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });

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
            await sock.sendMessage(msg.key.remoteJid, { text: '🚀 වේගය පරීක්ෂා කරමින් පවතී. තත්පර කිහිපයක් රැඳී සිටින්න...' }, { quoted: msg });
            
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
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`⚠️ Connection closed. Status Code: ${statusCode}`);
            
            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(() => startBot(), 5000); 
            } else {
                console.log('❌ Session එක සම්පූර්ණයෙන්ම ලොග් අවුට් වී ඇත. කරුණාකර අලුත් Session ID එකක් ලබාගන්න.');
                if (fs.existsSync('./auth_info_baileys')) {
                    fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            console.log('🎉 WhatsApp Bot successfully connected!');
        }
    });
}

startBot();
