import { PastQuotesSettings } from "@/components/settings/past-quotes-settings";
import { jobFilesAvailable } from "@/lib/archive/job-files";
import { listPastQuotes, pastQuotesAvailable } from "@/lib/archive/past-quotes";

export default function PastQuotesPage() {
  if (!pastQuotesAvailable()) return <PastQuotesSettings quotes={null} />;
  return <PastQuotesSettings quotes={listPastQuotes()} showFiles={jobFilesAvailable()} />;
}
