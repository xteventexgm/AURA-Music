import mongoose from 'mongoose';

const trackSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    artist: { type: String, default: 'Artista Desconocido' },
    duration: { type: String, default: '0:00' },
    thumbnail: { type: String, default: '' },
    filename: { type: String, default: null },
    addedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const playlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    localId: {
      type: String,
      default: null,
      index: true
    },
    name: {
      type: String,
      required: [true, 'El nombre de la playlist es obligatorio'],
      trim: true,
      maxlength: 100
    },
    description: {
      type: String,
      default: '',
      maxlength: 300
    },
    coverUrl: {
      type: String,
      default: ''
    },
    isPublic: {
      type: Boolean,
      default: false
    },
    tracks: [trackSchema]
  },
  {
    timestamps: true
  }
);

playlistSchema.index({ userId: 1, name: 1 });

export const Playlist = mongoose.model('Playlist', playlistSchema);
