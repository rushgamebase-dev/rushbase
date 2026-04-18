'use client';

interface Props {
  url: string;
  alt: string;
  className?: string;
}

export function BadgeMedia({ url, alt, className }: Props) {
  if (url.toLowerCase().endsWith('.mp4')) {
    return (
      <video
        src={url}
        autoPlay
        loop
        muted
        playsInline
        className={className}
        aria-label={alt}
      />
    );
  }
  return <img src={url} alt={alt} className={className} />;
}
