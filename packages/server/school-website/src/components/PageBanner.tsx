interface PageBannerProps {
  title: string;
  subtitle?: string;
}

export default function PageBanner({ title, subtitle }: PageBannerProps) {
  return (
    <div className="bg-emerald-800 text-white py-16 md:py-20">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h1 className="font-display text-3xl md:text-5xl font-bold mb-3">{title}</h1>
        {subtitle && <p className="text-emerald-100 text-lg max-w-2xl mx-auto">{subtitle}</p>}
      </div>
    </div>
  );
}
