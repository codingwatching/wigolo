-- SP1: Remove the browser-routing telemetry table for the removed browser backend.
-- This is routing telemetry (not user data); dropping it is safe.
-- Actual DROP is in the runner postStep (guarded against fresh DBs).
DROP TABLE IF EXISTS lightpanda_routing;
