import "server-only"

export {
  sendNotificationEmail,
  type AiQuotaNoticeNotification,
  type AuthorizationExpiringNotification,
  type CaptureRequestNotification,
  type DailyDigestNotification,
  type LeadSlaNoticeNotification,
  type NewLeadNotification,
  type NotificationKind,
  type NotificationParams,
  type NotificationSummary,
  type ReferralNoticeNotification,
  type SubscriptionNoticeNotification,
  type TeamInvitationNotification,
  type VisitAssignedNotification,
  type VisitReminderNotification,
  type WeeklyReportNotification,
} from "@/lib/email/notifications"
export { getEmailProvider } from "@/lib/email/provider"
export type {
  EmailAddress,
  EmailAttachment,
  EmailFailureReason,
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "@/lib/email/types"
