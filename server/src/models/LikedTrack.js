import mongoose from 'mongoose';

const likedTrackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    trackId: {
      type: String,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    artist: {
      type: String,
      default: 'Artista Desconocido'
    },
    duration: {
      type: String,
      default: '0:00'
    },
    thumbnail: {
      type: String,
      default: ''
    },
    likedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

likedTrackSchema.index({ userId: 1, trackId: 1 }, { unique: true });

export const LikedTrack = mongoose.model('LikedTrack', likedTrackSchema);
