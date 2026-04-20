import { Schema, model, Document } from 'mongoose';
import { InvestorStage } from '../types/enums.js';

export interface IInvestor extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  linkedinUrl?: string;
  stage: InvestorStage;
  notes?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const investorSchema = new Schema<IInvestor>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String },
    company: { type: String, trim: true },
    website: { type: String },
    linkedinUrl: { type: String },
    stage: {
      type: String,
      enum: Object.values(InvestorStage),
      default: InvestorStage.PROSPECT,
    },
    notes: { type: String },
    tags: { type: [String], default: [] },
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

investorSchema.index({ firstName: 'text', lastName: 'text', email: 'text', company: 'text' });

export const Investor = model<IInvestor>('Investor', investorSchema);
