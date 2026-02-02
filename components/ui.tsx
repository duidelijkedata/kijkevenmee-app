import React from "react";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}


export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }
) {
  const { variant = "secondary", className = "", ...rest } = props;
  const base =
    "h-12 rounded-xl px-4 text-base font-medium transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : "border bg-white hover:bg-slate-50 text-slate-900";
  return <button className={`${base} ${styles} ${className}`} {...rest} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full rounded-xl border bg-white px-3 text-base outline-none focus:ring-2 focus:ring-slate-200 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-[96px] w-full rounded-xl border bg-white px-3 py-2 text-base outline-none focus:ring-2 focus:ring-slate-200 ${props.className ?? ""}`}
    />
  );
}
