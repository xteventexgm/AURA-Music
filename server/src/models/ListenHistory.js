import mongoose from 'mongoose';

const listenHistorySchema = new mongoose.Schema(
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
      default: 'Artista Desconocido',
      index: true
    },
    duration: {
      type: String,
      default: '0:00'
    },
    thumbnail: {
      type: String,
      default: ''
    },
    listenedSeconds: {
      type: Number,
      default: 0
    },
    completed: {
      type: Boolean,
      default: false
    },
    playedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

listenHistorySchema.index({ userId: 1, playedAt: -1 });

export const ListenHistory = mongoose.model('ListenHistory', listenHistorySchema);
