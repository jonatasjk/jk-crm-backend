import { Schema, model, Document } from 'mongoose';
import { EntityType } from '../types/enums.js';

export interface IMaterial extends Document {
  name: string;
  description?: string;
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
  entityType: EntityType;
  createdAt: Date;
  updatedAt: Date;
}

const materialSchema = new Schema<IMaterial>(
  {
    name: { type: String, required: true },
    description: { type: String },
    fileKey: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    entityType: { type: String, enum: Object.values(EntityType), required: true },
  },
  { timestamps: true,
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

export const Material = model<IMaterial>('Material', materialSchema);
