import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'El nombre de usuario es obligatorio'],
      trim: true,
      minlength: [3, 'Mínimo 3 caracteres'],
      maxlength: [30, 'Máximo 30 caracteres']
    },
    email: {
      type: String,
      required: [true, 'El correo electrónico es obligatorio'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Correo electrónico inválido']
    },
    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: [6, 'Mínimo 6 caracteres']
    },
    avatarUrl: {
      type: String,
      default: ''
    },
    bio: {
      type: String,
      maxlength: 160,
      default: ''
    },
    preferences: {
      theme: { type: String, default: 'dark' },
      defaultAudioQuality: { type: String, default: 'high' }
    }
  },
  {
    timestamps: true
  }
);

// Hash de contraseña automático antes de guardar (Mongoose 9 async)
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Método para comparar contraseñas
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Formato seguro para respuestas JSON (sin contraseña)
userSchema.methods.toSafeObject = function () {
  let safeAvatarUrl = this.avatarUrl;
  if (safeAvatarUrl && safeAvatarUrl.includes('.r2.cloudflarestorage.com/avatars/')) {
    const filename = safeAvatarUrl.split('/avatars/')[1];
    if (filename) safeAvatarUrl = `/api/auth/avatar/${filename}`;
  } else if (safeAvatarUrl && safeAvatarUrl.includes('/avatar-stream/')) {
    const filename = safeAvatarUrl.split('/avatar-stream/')[1]?.replace(/^avatars%2F|^avatars\//, '');
    if (filename) safeAvatarUrl = `/api/auth/avatar/${filename}`;
  }

  return {
    id: this._id,
    username: this.username,
    email: this.email,
    avatarUrl: safeAvatarUrl,
    bio: this.bio,
    preferences: this.preferences,
    createdAt: this.createdAt
  };
};

export const User = mongoose.model('User', userSchema);
