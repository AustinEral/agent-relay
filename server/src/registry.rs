use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

use crate::types::RegistryEntry;

/// Redis-backed registry of DID -> endpoint mappings
#[derive(Clone)]
pub struct Registry {
    redis: redis::aio::ConnectionManager,
}

/// Stored entry format in Redis
#[derive(Serialize, Deserialize)]
struct StoredEntry {
    endpoint: String,
    registered_at: i64,
}

impl Registry {
    /// Create a new registry connected to Redis
    pub async fn new(redis_url: &str) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(redis_url)?;
        let redis = redis::aio::ConnectionManager::new(client).await?;
        Ok(Self { redis })
    }

    /// Register or update an agent's endpoint
    pub async fn register(&self, entry: RegistryEntry) -> Result<(), redis::RedisError> {
        let mut conn = self.redis.clone();
        
        // Calculate TTL in seconds
        let now = chrono::Utc::now().timestamp();
        let ttl = (entry.expires_at - now).max(1) as u64;

        // Store as JSON with TTL
        let stored = StoredEntry {
            endpoint: entry.endpoint,
            registered_at: entry.registered_at,
        };
        let value = serde_json::to_string(&stored).unwrap();

        // SET with EX (expiration in seconds)
        conn.set_ex::<_, _, ()>(&entry.did, value, ttl).await?;

        Ok(())
    }

    /// Look up an agent by DID
    pub async fn lookup(&self, did: &str) -> Result<Option<RegistryEntry>, redis::RedisError> {
        let mut conn = self.redis.clone();

        // GET the value
        let value: Option<String> = conn.get(did).await?;

        match value {
            Some(json) => {
                let stored: StoredEntry = serde_json::from_str(&json).unwrap();
                
                // Get TTL to calculate expires_at
                let ttl: i64 = conn.ttl(did).await?;
                let now = chrono::Utc::now().timestamp();

                Ok(Some(RegistryEntry {
                    did: did.to_string(),
                    endpoint: stored.endpoint,
                    registered_at: stored.registered_at,
                    expires_at: now + ttl,
                }))
            }
            None => Ok(None),
        }
    }

    /// Remove an agent's registration
    pub async fn deregister(&self, did: &str) -> Result<bool, redis::RedisError> {
        let mut conn = self.redis.clone();
        let deleted: i64 = conn.del(did).await?;
        Ok(deleted > 0)
    }
}
