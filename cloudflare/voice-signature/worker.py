from workers import WorkerEntrypoint, Response
from edge_drm import generate_sec_ms_gec_v2


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response.json({"token": generate_sec_ms_gec_v2(), "version": "2-143.0.3650.75"})
