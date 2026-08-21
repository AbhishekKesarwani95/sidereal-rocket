import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import CreateRoom from './pages/CreateRoom';
import CheckBlur from './pages/CheckBlur';
import Room from './pages/Room';
import RandomCall from './pages/RandomCall';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import HostMode from './pages/HostMode';

function AppShell() {
  const location = useLocation();
  const isRoomPage = location.pathname.startsWith('/room/');

  return (
    <>
      {!isRoomPage && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateRoom />} />
        <Route path="/check-blur" element={<CheckBlur />} />
        <Route path="/room/:code" element={<Room />} />
        <Route path="/random" element={<RandomCall />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/host" element={<HostMode />} />
        <Route path="*" element={
          <div className="page-wrapper" style={{ paddingTop: 'var(--sp-16)', textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: 'var(--sp-4)' }}>🌫️</div>
            <h2>Page Not Found</h2>
            <p style={{ margin: 'var(--sp-4) 0 var(--sp-6)' }}>This room or page doesn't exist, may have expired, or the link is invalid.</p>
            <a href="/" className="btn btn-primary">Go Home</a>
          </div>
        } />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
