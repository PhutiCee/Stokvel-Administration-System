"use client";
import { useState } from "react";
import Button from "@/components/ui/Button";
import { Card, Alert, StandingBadge } from "@/components/ui/States";
export default function NegotiatedOrder({ candidates, onClose, onConfirm }) {
  const [order, setOrder] = useState(candidates),
    [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function move(index, delta) {
    setOrder((rows) => {
      const next = [...rows];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
    setAgreed(false);
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onConfirm(order.map((m) => m.memberId));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Card className="p-5 mb-5">
      <form onSubmit={submit}>
        <h2 className="font-semibold">Negotiated payout order</h2>
        <p className="text-sm text-ink-500 mt-2">
          Arrange every active member in the order agreed by the club. Position
          1 is paid first. Use the move buttons to change positions.
        </p>
        {!order.length && (
          <Alert tone="attention" className="mt-3">
            There are no members available for the queue.
          </Alert>
        )}
        <ol className="my-4 divide-y divide-line">
          {order.map((m, i) => (
            <li
              key={m.memberId}
              className="py-3 flex flex-wrap gap-2 items-center"
            >
              <span className="text-sm min-w-0 flex-1 break-words">
                {i + 1}. {m.fullName}
              </span>
              <StandingBadge standing={m.standing} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || i === 0}
                aria-label={`Move ${m.fullName} up`}
                onClick={() => move(i, -1)}
              >
                Up
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || i === order.length - 1}
                aria-label={`Move ${m.fullName} down`}
                onClick={() => move(i, 1)}
              >
                Down
              </Button>
            </li>
          ))}
        </ol>
        <label className="flex gap-2 text-sm items-start">
          <input
            type="checkbox"
            checked={agreed}
            disabled={busy}
            onChange={(e) => setAgreed(e.target.checked)}
            required
          />
          This is the order agreed by the club.
        </label>
        {error && (
          <Alert tone="exception" className="mt-3">
            {error} If membership has changed, cancel and reload the page to
            refresh the list.
          </Alert>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          <Button
            type="submit"
            loading={busy}
            disabled={!agreed || !order.length}
          >
            Establish agreed order
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
