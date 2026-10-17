import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_AVATARS_DIR = path.join(__dirname, '../../uploads/avatars');

// Asegurar carpeta local de respaldo
if (!fs.existsSync(LOCAL_AVATARS_DIR)) {
  fs.mkdirSync(LOCAL_AVATARS_DIR, { recursive: true });
}

let s3Client = null;

function getS3Client() {
  if (s3Client) return s3Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (accountId && accessKeyId && secretAccessKey) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId.trim()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim()
      }
    });
    console.log('☁️ [Cloudflare R2]: Cliente S3 inicializado correctamente.');
    return s3Client;
  }

  return null;
}

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

/**
 * Purgar todos los avatares previos de un usuario (tanto en Cloudflare R2 como en disco local)
 * para evitar acumulación de imágenes residuales.
 */
export async function purgeUserAvatars(userId) {
  if (!userId) return;
  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME || 'aura-media';

  // 1. Purgar en Cloudflare R2
  if (client && isR2Configured()) {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `avatars/${userId}`
      });
      const listed = await client.send(listCommand);
      if (listed.Contents && listed.Contents.length > 0) {
        for (const item of listed.Contents) {
          console.log(`🗑️ [Cloudflare R2]: Purgando avatar antiguo ${item.Key}...`);
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: item.Key
            })
          ).catch((e) => console.warn(`Error al borrar ${item.Key}:`, e.message));
        }
      }
    } catch (err) {
      console.warn('⚠️ [R2 Purge Error]:', err.message);
    }
  }

  // 2. Purgar en almacenamiento local
  try {
    if (fs.existsSync(LOCAL_AVATARS_DIR)) {
      const files = await fs.promises.readdir(LOCAL_AVATARS_DIR);
      for (const file of files) {
        if (file.startsWith(userId)) {
          console.log(`🗑️ [Local Storage]: Purgando avatar antiguo local ${file}...`);
          await fs.promises.unlink(path.join(LOCAL_AVATARS_DIR, file)).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [Local Purge Error]:', err.message);
  }
}

/**
 * Subir avatar de usuario (a Cloudflare R2 o con fallback local),
 * asegurando la eliminación previa de cualquier imagen anterior.
 */
export async function uploadAvatarFile(userId, fileBuffer, originalname, mimeType) {
  // Purgar proactivamente todas las imágenes anteriores de este usuario
  await purgeUserAvatars(userId);

  const ext = (path.extname(originalname) || '.jpg').toLowerCase();
  const filename = `${userId}-${Date.now()}${ext}`;
  const key = `avatars/${filename}`;

  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME || 'aura-media';

  // 1. Si Cloudflare R2 está configurado, subir al Bucket
  if (client && isR2Configured()) {
    try {
      console.log(`☁️ [Cloudflare R2]: Subiendo avatar ${key} a bucket ${bucketName}...`);
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType || 'image/jpeg',
          CacheControl: 'public, max-age=86400'
        })
      );

      const publicUrl = process.env.R2_PUBLIC_URL?.trim()?.replace(/\/$/, '');
      const isDirectPublicCdn = publicUrl && !publicUrl.includes('.r2.cloudflarestorage.com');
      if (isDirectPublicCdn) {
        return `${publicUrl}/${key}`;
      }

      // Si no hay dominio público externo configurado, el servidor actúa como streaming proxy
      return `/api/auth/avatar/${filename}`;
    } catch (err) {
      console.error('❌ [Cloudflare R2 Error]: Fallo al subir a R2, recurriendo a local:', err.message);
    }
  }

  // 2. Fallback Local transparente (para desarrollo o si no hay R2)
  console.log(`📁 [Local Storage]: Guardando avatar en almacenamiento local (${filename})...`);
  const localFilePath = path.join(LOCAL_AVATARS_DIR, filename);
  await fs.promises.writeFile(localFilePath, fileBuffer);

  return `/api/auth/avatar/${filename}`;
}

/**
 * Obtener stream de objeto desde Cloudflare R2
 */
export async function getR2ObjectStream(key) {
  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME || 'aura-media';
  if (!client) throw new Error('Cloudflare R2 no configurado');

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key
  });

  return await client.send(command);
}

/**
 * Eliminar avatar antiguo si es necesario
 */
export async function deleteAvatarFile(avatarUrl) {
  if (!avatarUrl) return;

  const client = getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME || 'aura-media';

  let filename = null;
  const decoded = decodeURIComponent(avatarUrl);
  if (decoded.includes('avatars/')) {
    filename = decoded.split('avatars/')[1]?.split(/[?#]/)[0];
  } else if (decoded.includes('/avatar/')) {
    filename = decoded.split('/avatar/')[1]?.split(/[?#]/)[0];
  } else if (decoded.includes('/avatar-local/')) {
    filename = decoded.split('/avatar-local/')[1]?.split(/[?#]/)[0];
  } else if (decoded.includes('/avatar-stream/')) {
    filename = path.basename(decoded.split('/avatar-stream/')[1]?.split(/[?#]/)[0]);
  }

  if (!filename) {
    filename = path.basename(decoded);
  }

  const key = `avatars/${filename}`;

  // 1. Borrar de R2
  if (client && isR2Configured()) {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      );
      console.log(`🗑️ [Cloudflare R2]: Borrado ${key}`);
    } catch (e) {
      console.warn('No se pudo borrar avatar viejo de R2:', e.message);
    }
  }

  // 2. Borrar de disco local
  try {
    const localPath = path.join(LOCAL_AVATARS_DIR, filename);
    if (fs.existsSync(localPath)) {
      await fs.promises.unlink(localPath);
      console.log(`🗑️ [Local Storage]: Borrado local ${filename}`);
    }
  } catch {}
}
