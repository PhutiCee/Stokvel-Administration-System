import Badge from "@/components/ui/Badge";
import { CheckCircle2, CircleDashed, CircleSlash, AlertTriangle, Clock, Ban, LogOut, ShieldAlert, FileCheck2, Hourglass } from "lucide-react";

// Status never relies on colour alone: each carries an icon and a word.
const MAP = {
  Paid: { tone: "positive", icon: CheckCircle2 },
  Partial: { tone: "attention", icon: CircleDashed },
  Outstanding: { tone: "neutral", icon: Clock },
  Late: { tone: "exception", icon: AlertTriangle },
  "Good standing": { tone: "positive", icon: CheckCircle2 },
  "In arrears": { tone: "attention", icon: AlertTriangle },
  Suspended: { tone: "exception", icon: CircleSlash },
  Expelled: { tone: "exception", icon: Ban },
  Exited: { tone: "neutral", icon: LogOut },
  Initiated: { tone: "attention", icon: Hourglass },
  Approved: { tone: "positive", icon: CheckCircle2 },
  Cancelled: { tone: "neutral", icon: Ban },
  Lodged: { tone: "attention", icon: Hourglass },
  Assessed: { tone: "accent", icon: FileCheck2 },
  Refused: { tone: "exception", icon: Ban },
  Paid_claim: { tone: "positive", icon: CheckCircle2 },
  Clean: { tone: "positive", icon: CheckCircle2 },
  Exception: { tone: "exception", icon: ShieldAlert },
  Active: { tone: "positive", icon: CheckCircle2 },
  Open: { tone: "accent", icon: CircleDashed },
  Closed: { tone: "neutral", icon: CheckCircle2 },
  Delivered: { tone: "positive", icon: CheckCircle2 },
  Undeliverable: { tone: "exception", icon: AlertTriangle }
};

export default function StatusBadge({ status, className }) {
  const cfg = MAP[status] || { tone: "neutral", icon: CircleDashed };
  return <Badge tone={cfg.tone} icon={cfg.icon} className={className}>{status}</Badge>;
}
