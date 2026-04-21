import { Schema, model, Document, Types } from 'mongoose';
import { EmailStatus } from '../types/enums.js';

export interface IEmailAttachment {
  materialId: Types.ObjectId;
  materialName: string;
}

export interface IEmailLog extends Document {
  investorId?: Types.ObjectId;
  partnerId?: Types.ObjectId;
  enrollmentId?: Types.ObjectId;
  stepIndex?: number;
  subject: string;
  body: string;
  status: EmailStatus;
  errorMessage?: string;
  sesMessageId?: string;
  sentAt?: Date;
  attachments: IEmailAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const emailLogSchema = new Schema<IEmailLog>(
  {
    investorId: { type: Schema.Types.ObjectId, ref: 'Investor' },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner' },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment' },
    stepIndex: { type: Number },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: Object.values(EmailStatus), default: EmailStatus.PENDING },
    errorMessage: { type: String },
    sesMessageId: { type: String },
    sentAt: { type: Date },
    attachments: [
      {
        materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
        materialName: { type: String, required: true },
      },
    ],
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

emailLogSchema.index({ investorId: 1 });
emailLogSchema.index({ partnerId: 1 });

export const EmailLog = model<IEmailLog>('EmailLog', emailLogSchema);
