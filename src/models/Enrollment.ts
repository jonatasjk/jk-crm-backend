import { Schema, model, Document, Types } from 'mongoose';
import { EntityType } from '../types/enums.js';

export interface IEnrollmentStepLog {
  stepIndex: number;    // 0-based
  sentAt: Date;
  emailLogId: Types.ObjectId;
}

export interface IEnrollment extends Document {
  sequenceId: Types.ObjectId;
  entityId: Types.ObjectId;
  entityType: (typeof EntityType)[keyof typeof EntityType];
  status: 'ACTIVE' | 'COMPLETED' | 'REPLIED' | 'UNSUBSCRIBED';
  currentStepIndex: number;   // index of next step to send (0-based); -1 = not started
  nextSendAt: Date;
  enrolledAt: Date;
  completedAt?: Date;
  stepsLog: IEnrollmentStepLog[];
  createdAt: Date;
  updatedAt: Date;
}

const stepLogSchema = new Schema<IEnrollmentStepLog>(
  {
    stepIndex: { type: Number, required: true },
    sentAt: { type: Date, required: true },
    emailLogId: { type: Schema.Types.ObjectId, ref: 'EmailLog', required: true },
  },
  { _id: false },
);

const enrollmentSchema = new Schema<IEnrollment>(
  {
    sequenceId: { type: Schema.Types.ObjectId, ref: 'Sequence', required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    entityType: { type: String, enum: Object.values(EntityType), required: true },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'REPLIED', 'UNSUBSCRIBED'], default: 'ACTIVE' },
    currentStepIndex: { type: Number, default: 0 },
    nextSendAt: { type: Date, required: true },
    enrolledAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date },
    stepsLog: { type: [stepLogSchema], default: [] },
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

// Prevent duplicate active enrollment of the same entity in the same sequence
enrollmentSchema.index({ sequenceId: 1, entityId: 1 }, { unique: true });
enrollmentSchema.index({ status: 1, nextSendAt: 1 }); // for scheduler queries

export const Enrollment = model<IEnrollment>('Enrollment', enrollmentSchema);
