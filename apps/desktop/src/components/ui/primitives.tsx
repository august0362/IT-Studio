import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  JSX,
  ReactNode,
  Ref,
} from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: 'primary' | 'secondary' | 'danger';
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({ tone = 'secondary', className = '', type = 'button', ...props }: ButtonProps): JSX.Element {
  return <button className={`studio-button studio-button-${tone} ${className}`} type={type} {...props} />;
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly ref?: Ref<HTMLDivElement>;
}

export function Card({ className = '', ...props }: CardProps): JSX.Element {
  return <div className={`studio-card ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={`studio-input ${className}`} {...props} />;
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export function Chip({ tone = 'neutral', className = '', ...props }: ChipProps): JSX.Element {
  return <span className={`studio-chip studio-chip-${tone} ${className}`} {...props} />;
}

export interface KpiTileProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string;
  readonly value: ReactNode;
}

export function KpiTile({ label, value, children, className = '', ...props }: KpiTileProps): JSX.Element {
  return (
    <Card className={`studio-kpi ${className}`} {...props}>
      <p className="text-sm text-text-muted">{label}</p>
      <div className="studio-kpi-value">{value}</div>
      {children}
    </Card>
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select className={`studio-input ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea className={`studio-input ${className}`} {...props} />;
}
