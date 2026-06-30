import { type ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
}

const variantClass: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-zinc-900 text-white hover:bg-zinc-700',
  ghost: 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

export default function Button({ variant = 'primary', className = '', ...props }: Props) {
  return (
    <button
      {...props}
      className={`rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${variantClass[variant]} ${className}`}
    />
  );
}
