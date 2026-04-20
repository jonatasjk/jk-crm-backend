import { Schema, model, Document, Types } from 'mongoose';
import { EntityType } from '../types/enums.js';

export interface ISequenceStep {
  order: number;        // 1-based display order
  subject: string;
  bodyHtml: string;
  delayDays: number;    // days after the previous step was sent (0 = same day as enrollment)
  materialId?: Types.ObjectId;
}

export interface ISequence extends Document {
  name: string;
  description?: string;
  entityType: (typeof EntityType)[keyof typeof EntityType];
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  scheduledStartAt?: Date;
  steps: ISequenceStep[];
  createdAt: Date;
  updatedAt: Date;
}

const sequenceStepSchema = new Schema<ISequenceStep>(
  {
    order: { type: Number, required: true },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    delayDays: { type: Number, required: true, min: 0, default: 0 },
    materialId: { type: Schema.Types.ObjectId, ref: 'Material' },
  },
  { _id: false },
);

const sequenceSchema = new Schema<ISequence>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    entityType: { type: String, enum: Object.values(EntityType), required: true },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'PAUSED'], default: 'DRAFT' },
    scheduledStartAt: { type: Date },
    steps: { type: [sequenceStepSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret['id'] = String(ret['_id']);
        delete ret['_id'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

export const Sequence = model<ISequence>('Sequence', sequenceSchema);
