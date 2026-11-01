# QuickShop · gateway

**Point d'entrée unique** de QuickShop (Node.js 20, aucune dépendance npm) : c'est le seul composant à exposer
publiquement. Il sert l'interface web et route chaque appel `/api/*` vers le bon microservice (pattern API Gateway).

| Chemin public | Microservice |
|---|---|
| `/api/products/*`, `/api/categories/*` | catalog-service |
| `/api/orders/*`, `/api/workers/*` | order-service |
| `/api/system/status` | agrégation de l'état de tous les microservices |

```bash
docker build -t gateway .
docker run -d -p 8080:8080 -e CATALOG_URL=http://<catalog-service>:8001 -e ORDERS_URL=http://<order-service>:8002 gateway
npm test   # 4 tests
```

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | Port HTTP |
| `CATALOG_URL` | `http://catalog-service:8001` | URL interne de catalog-service |
| `ORDERS_URL` | `http://order-service:8002` | URL interne d'order-service |

Si un microservice est indisponible, la gateway renvoie une erreur 503 pour ses routes seulement ; le reste continue.
Chaque requête reçoit un `X-Request-Id` transmis aux microservices, pour suivre une requête dans tous les logs.
Utilisateur non-root `1000:1000`, aucune écriture disque.
