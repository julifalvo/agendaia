import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ProfileProvider } from "./hooks/useProfile";
import { PublicSite } from "./pages/PublicSite";
import { PrivacyPolicy } from "./pages/PrivacyPolicy";
import { TermsOfService } from "./pages/TermsOfService";
import { SetPassword } from "./pages/SetPassword";
import { AdminLayout, RequireFullAccess } from "./admin/AdminLayout";
import { AdminMyBookings } from "./admin/AdminMyBookings";
import { AdminCalendar } from "./admin/AdminCalendar";
import { AdminServices } from "./admin/AdminServices";
import { AdminStaff } from "./admin/AdminStaff";
import { AdminSchedule } from "./admin/AdminSchedule";
import { AdminClosures } from "./admin/AdminClosures";

export default function App() {
  return (
    <AuthProvider>
      <ProfileProvider>
        <Routes>
          <Route path="/" element={<PublicSite />} />
          <Route path="/privacidad" element={<PrivacyPolicy />} />
          <Route path="/terminos" element={<TermsOfService />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminMyBookings />} />
            <Route path="calendar" element={<AdminCalendar />} />
            <Route element={<RequireFullAccess />}>
              <Route path="services" element={<AdminServices />} />
              <Route path="staff" element={<AdminStaff />} />
              <Route path="staff/:staffId/schedule" element={<AdminSchedule />} />
              <Route path="closures" element={<AdminClosures />} />
            </Route>
          </Route>
        </Routes>
      </ProfileProvider>
    </AuthProvider>
  );
}
