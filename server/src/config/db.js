import mongoose from 'mongoose';
import dns from 'dns';

// Solución al problema común de Windows con querySrv ECONNREFUSED en Node.js:
// Forzar orden IPv4 y configurar servidores DNS globales (Google & Cloudflare)
try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  console.warn('[DNS Setup]:', e.message);
}

let isConnected = false;

export async function connectDB(retries = 3) {
  const uri = process.env.MONGODB_URI;

  if (!uri || !uri.trim()) {
    console.warn('\n⚠️ [MongoDB Atlas]: Variable MONGODB_URI no definida en .env');
    console.warn('👉 El servidor operará en MODO LOCAL / INVITADO (sin sincronización cloud hasta configurar Atlas).\n');
    isConnected = false;
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[MongoDB Atlas]: Estableciendo conexión (intento ${attempt}/${retries})...`);
      await mongoose.connect(uri.trim(), {
        serverSelectionTimeoutMS: 8000,
        family: 4 // Forzar IPv4
      });
      isConnected = true;
      console.log('✅ [MongoDB Atlas]: Conexión exitosa a la base de datos en la nube.');
      return true;
    } catch (error) {
      isConnected = false;
      console.error(`❌ [MongoDB Atlas Error (intento ${attempt})]:`, error.message);

      if (attempt < retries) {
        // En caso de que el router del usuario tenga problemas con SRV, reintentar con DNS directo
        try {
          dns.setServers(['1.1.1.1', '8.8.8.8', '8.8.4.4']);
        } catch {}
        console.log('🔄 Reintentando conexión con DNS público en 2 segundos...');
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.warn('👉 Revisa tus credenciales o IP Whitelist (permite 0.0.0.0/0 en Network Access de MongoDB Atlas). El servidor continuará en modo local.\n');
        return false;
      }
    }
  }
}

export function isMongoConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}
