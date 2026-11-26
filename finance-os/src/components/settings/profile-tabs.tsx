"use client";
import * as React from "react";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { updatePreferencesAction, updateProfileAction } from "@/server/actions/data";
import { CURRENCIES, CURRENCY_LABELS, formatMoney } from "@/lib/finance/money";
import { DATE_FORMATS, NUMBER_LOCALES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/misc";
import { Avatar } from "@/components/layout/sidebar";
import { format } from "date-fns";
import { Section, type SettingsUser } from "./settings-view";

/** Downscale an image file to a small square avatar data URL. */
async function toAvatar(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function ProfileTab({ user }: { user: SettingsUser }) {
  const [name, setName] = React.useState(user.fullName);
  const [avatar, setAvatar] = React.useState<string | null>(user.avatarData);
  const [busy, setBusy] = React.useState(false);
  return (
    <Section title="Profile" description="How you appear in Finance OS.">
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={name || user.email} src={avatar} size={64} />
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <label className="cursor-pointer">
                <Upload /> Upload photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 8 * 1024 * 1024) return toast.error("Choose an image under 8 MB.");
                    try {
                      setAvatar(await toAvatar(file));
                    } catch {
                      toast.error("Couldn't read that image. Try a PNG or JPEG.");
                    }
                  }}
                />
              </label>
            </Button>
            {avatar && (
              <Button variant="ghost" size="sm" onClick={() => setAvatar(null)}>
                <X /> Remove
              </Button>
            )}
          </div>
        </div>
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email" hint="Used to sign in.">
            <Input value={user.email} disabled />
          </Field>
        </div>
        <Button
          loading={busy}
          onClick={async () => {
            if (!name.trim()) return toast.error("Enter your name.");
            setBusy(true);
            const r = await updateProfileAction({ fullName: name, avatarData: avatar });
            setBusy(false);
            if (r.ok) toast.success("Profile saved");
            else toast.error(r.error);
          }}
        >
          Save profile
        </Button>
      </div>
    </Section>
  );
}

export function PreferencesTab({ user }: { user: SettingsUser }) {
  const [p, setP] = React.useState({
    baseCurrency: user.baseCurrency,
    dateFormat: user.dateFormat,
    numberLocale: user.numberLocale,
    theme: user.theme,
    timezone: user.timezone,
    budgetRolloverDefault: user.budgetRolloverDefault,
    emergencyFundMonths: user.emergencyFundMonths,
  });
  const [busy, setBusy] = React.useState(false);
  const zones = React.useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [user.timezone, "UTC"];
    }
  }, [user.timezone]);
  const save = async () => {
    setBusy(true);
    const r = await updatePreferencesAction(p);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    const dark = p.theme === "dark" || (p.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    toast.success("Preferences saved");
  };
  return (
    <div className="space-y-6">
      <Section title="Display" description="Formats used across the app.">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Base currency" hint="Net worth and reports are shown in this currency using your stored exchange rates.">
            <Select aria-label="Base currency" value={p.baseCurrency} onValueChange={(v) => setP({ ...p, baseCurrency: v })} options={CURRENCIES.map((c) => ({ value: c, label: `${c} — ${CURRENCY_LABELS[c]}` }))} />
          </Field>
          <Field label="Theme">
            <Select aria-label="Theme" value={p.theme} onValueChange={(v) => setP({ ...p, theme: v as "light" })} options={[{ value: "system", label: "Match system" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Field>
          <Field label="Date format">
            <Select aria-label="Date format" value={p.dateFormat} onValueChange={(v) => setP({ ...p, dateFormat: v })} options={DATE_FORMATS.map((d) => ({ value: d, label: `${d}  ·  ${format(new Date(2026, 2, 31), d)}` }))} />
          </Field>
          <Field label="Number format">
            <Select aria-label="Number format" value={p.numberLocale} onValueChange={(v) => setP({ ...p, numberLocale: v })} options={Object.keys(NUMBER_LOCALES).map((l) => ({ value: l, label: formatMoney(123456789, p.baseCurrency, { locale: l }) }))} />
          </Field>
          <Field label="Time zone" hint="Decides what “today” and “this month” mean.">
            <Select aria-label="Time zone" value={p.timezone} onValueChange={(v) => setP({ ...p, timezone: v })} options={zones.map((z) => ({ value: z, label: z }))} />
          </Field>
          <Field label="Language" hint="More languages are planned.">
            <Select aria-label="Language" value="en" onValueChange={() => undefined} disabled options={[{ value: "en", label: "English" }]} />
          </Field>
        </div>
      </Section>
      <Section title="Financial defaults">
        <div className="max-w-2xl space-y-4">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Roll over unused budget by default</span>
              <span className="block text-xs text-muted-foreground">New budget categories carry unspent money into the next month.</span>
            </span>
            <Switch checked={p.budgetRolloverDefault} onCheckedChange={(c) => setP({ ...p, budgetRolloverDefault: c })} />
          </label>
          <Field label="Emergency fund target (months of expenses)" hint="Used by Financial health and the affordability answer when no emergency-fund goal exists.">
            <Input type="number" min={1} max={24} className="w-28" value={p.emergencyFundMonths} onChange={(e) => setP({ ...p, emergencyFundMonths: Number(e.target.value) })} />
          </Field>
        </div>
      </Section>
      <Button loading={busy} onClick={save}>
        Save preferences
      </Button>
    </div>
  );
}
