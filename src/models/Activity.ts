import { Schema, model, Document, Types } from 'mongoose';
import { ActivityType } from '../types/enums.js';

export interface IActivity extends Document {
  investorId?: Types.ObjectId;
  partnerId?: Types.ObjectId;
  type: ActivityType;
  detail?: string;
  createdAt: Date;
  updatedAt: Date;
}

const activitySchema = new Schema<IActivity>(
  {
    investorId: { type: Schema.Types.ObjectId, ref: 'Investor' },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner' },
    type: { type: String, enum: Object.values(ActivityType), required: true },
    detail: { type: String },
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

activitySchema.index({ investorId: 1, createdAt: -1 });
activitySchema.index({ partnerId: 1, createdAt: -1 });

export const Activity = model<IActivity>('Activity', activitySchema);
