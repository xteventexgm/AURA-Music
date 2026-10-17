import mongoose from 'mongoose';

const userBackupSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      default: () => `Respaldo Nube - ${new Date().toLocaleDateString()}`
    },
    version: {
      type: String,
      default: '2.0.0'
    },
    trackCount: {
      type: Number,
      default: 0
    },
    playlistCount: {
      type: Number,
      default: 0
    },
    payload: {
      playlists: { type: Array, default: [] },
      likedTracks: { type: Array, default: [] }
    }
  },
  {
    timestamps: true
  }
);

userBackupSchema.index({ userId: 1, createdAt: -1 });

export const UserBackup = mongoose.model('UserBackup', userBackupSchema);
