import React, { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Dashboard } from "./pages/Dashboard";
import { ConfigsPage } from "./pages/ConfigsPage";
import { ConfigFormPage } from "./pages/ConfigFormPage";
import { JobsPage } from "./pages/JobsPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { SuitePage } from "./pages/SuitePage";
import { subscribeToAll } from "./socket";

const App: React.FC = () => {
  useEffect(() => {
    subscribeToAll();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      <Navbar />
      <main className="pt-14">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/configs" element={<ConfigsPage />} />
          <Route path="/configs/new" element={<ConfigFormPage />} />
          <Route path="/configs/:id/edit" element={<ConfigFormPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/suites/:id" element={<SuitePage />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
