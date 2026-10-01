"use client";
export const fieldClass =
  "block w-full border border-line rounded p-2 bg-white mt-1 mb-3";
export function Action({ children, ...props }) {
  return (
    <button
      {...props}
      className="rounded border border-line px-3 py-2 mr-2 my-1 bg-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}
export function Feedback({ error, message }) {
  return (
    <>
      {error && (
        <p role="alert" className="p-3 mb-4 bg-red-50 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="p-3 mb-4 bg-green-50 text-green-800">
          {message}
        </p>
      )}
    </>
  );
}
