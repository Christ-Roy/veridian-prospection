import { NotificationPreferencesForm } from "@/components/dashboard/notification-preferences-form";

export default function NotificationsSettingsPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Règle les rappels push pour tes RDV et rappels pipeline.
        </p>
      </div>
      <NotificationPreferencesForm />
    </div>
  );
}
