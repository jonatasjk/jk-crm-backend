import { Schema, model, Document, Types } from 'mongoose';
import { Role } from '../types/enums.js';

export interface IInvitation extends Document {
  email: string;
  tokenHash: string;
  invitedBy: Types.ObjectId;
  role: Role;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
}

const invitationSchema = new Schema<IInvitation>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: Object.values(Role), default: Role.MEMBER },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
);

invitationSchema.index({ email: 1 });

export const Invitation = model<IInvitation>('Invitation', invitationSchema);
