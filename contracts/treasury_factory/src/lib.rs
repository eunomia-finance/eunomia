#![no_std]
//! Eunomia Treasury Factory
//!
//! One signature from zero to an autonomous agent. Creating a treasury used to be five
//! owner-signed transactions (deploy, register, fund, approve payee, start the Leash) —
//! seven passkey prompts for a new user. `create` does all of it in a single invocation:
//! the owner authorises the root call once, and every sub-call the treasury, the token
//! and the registry require from the owner hangs off that one authorisation tree.
//!
//! The factory holds no funds and has no admin. It only knows which treasury code to
//! instantiate (the wasm hash the app ships) and where the registry is — both fixed at
//! deploy time, so a factory can never be re-pointed at different code.
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, BytesN,
    Env, Vec,
};

/// A time-bound, spend-capped agent credential to start the treasury with (the Leash).
#[contracttype]
#[derive(Clone)]
pub struct Leash {
    pub agent: Address,
    pub valid_until: u64,
    pub limit: i128,
}

/// Everything a treasury needs to be useful on the first ledger it exists in.
#[contracttype]
#[derive(Clone)]
pub struct Setup {
    /// Owner of the funds: becomes the treasury's admin AND root agent (as the app did).
    pub owner: Address,
    /// SEP-41 / SAC token the treasury holds and spends.
    pub token: Address,
    pub daily_limit: i128,
    pub per_task_limit: i128,
    /// Payees approved from the start (may be empty).
    pub payees: Vec<Address>,
    /// Start a Leash for an agent key right away: empty = none, one entry = that agent.
    /// (A `Vec` rather than an `Option`: the SDK's spec cannot carry an optional struct.)
    pub leash: Vec<Leash>,
    /// Amount of `token` moved from the owner into the treasury (0 = unfunded).
    pub fund: i128,
    /// Record the treasury under the owner in the registry (cross-device recovery).
    pub register: bool,
    /// Caller-chosen; the treasury address is derived from the factory and this salt.
    pub salt: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    TreasuryWasm,
    Registry,
}

/// The slice of the treasury interface the factory drives. Both calls are admin-only on
/// the treasury, so each one becomes a sub-invocation under the owner's authorisation.
#[contractclient(name = "TreasuryClient")]
pub trait TreasuryApi {
    fn add_payee(env: Env, payee: Address);
    fn set_session(env: Env, agent: Address, valid_until: u64, limit: i128);
}

#[contractclient(name = "RegistryClient")]
pub trait RegistryApi {
    fn register(env: Env, owner: Address, treasury: Address);
}

#[contract]
pub struct TreasuryFactory;

#[contractimpl]
impl TreasuryFactory {
    /// Pins the treasury code and the registry. Immutable after deploy (no setters): a
    /// factory that could be re-pointed would be a way to hand users different code.
    pub fn __constructor(env: Env, treasury_wasm: BytesN<32>, registry: Address) {
        env.storage()
            .instance()
            .set(&DataKey::TreasuryWasm, &treasury_wasm);
        env.storage().instance().set(&DataKey::Registry, &registry);
    }

    pub fn treasury_wasm(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::TreasuryWasm).unwrap()
    }

    pub fn registry(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Registry).unwrap()
    }

    /// Deploy a treasury and set it up — one owner signature for the whole thing.
    ///
    /// Order matters for atomicity only in the sense that any refusal (an incoherent
    /// policy in the constructor, an invalid Leash, an unfunded owner) aborts the entire
    /// transaction: no half-configured treasury can exist.
    pub fn create(env: Env, s: Setup) -> Address {
        s.owner.require_auth();
        if s.leash.len() > 1 {
            panic!("at most one Leash");
        }
        let wasm: BytesN<32> = env.storage().instance().get(&DataKey::TreasuryWasm).unwrap();
        let registry: Address = env.storage().instance().get(&DataKey::Registry).unwrap();

        // 1. The treasury: constructor validates the policy (InvalidLimits aborts here).
        let treasury = env.deployer().with_current_contract(s.salt.clone()).deploy_v2(
            wasm,
            (
                s.owner.clone(),
                s.owner.clone(),
                s.token.clone(),
                s.daily_limit,
                s.per_task_limit,
            ),
        );
        let t = TreasuryClient::new(&env, &treasury);

        // 2. Approved payees.
        for payee in s.payees.iter() {
            t.add_payee(&payee);
        }

        // 3. The Leash (an agent key the owner already holds the public half of).
        if let Some(l) = s.leash.first() {
            t.set_session(&l.agent, &l.valid_until, &l.limit);
        }

        // 4. Funding, straight from the owner — the treasury never touches the owner's key.
        if s.fund > 0 {
            token::TokenClient::new(&env, &s.token).transfer(&s.owner, &treasury, &s.fund);
        }

        // 5. Cross-device discovery.
        if s.register {
            RegistryClient::new(&env, &registry).register(&s.owner, &treasury);
        }

        env.events()
            .publish((symbol_short!("created"), s.owner), treasury.clone());
        treasury
    }
}

mod test;
