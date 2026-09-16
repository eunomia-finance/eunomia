#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    contracttype,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, IntoVal, Symbol,
};

// The treasury this factory instantiates: the v3.5 wasm the app ships, vendored so the
// test needs no toolchain step (CI runs `cargo test --workspace` alone). The hash check
// below is what keeps the fixture honest — it must be the code users actually get.
const TREASURY_WASM: &[u8] = include_bytes!("../fixtures/treasury_v3_5.wasm");
const TREASURY_V3_5_HASH: [u8; 32] = [
    0x82, 0x44, 0x72, 0x06, 0x0b, 0x3a, 0xbe, 0xc7, 0xc6, 0xc6, 0x4e, 0x89, 0x85, 0xfa, 0x5d, 0x0c,
    0x5a, 0x39, 0xea, 0x27, 0x7f, 0xbb, 0x67, 0xea, 0xb3, 0x12, 0x5a, 0x48, 0x3d, 0x05, 0x96, 0x41,
];
const REGISTRY_WASM: &[u8] = include_bytes!("../fixtures/treasury_registry.wasm");

/// The treasury's own types, mirrored for reads (same field names and order = same XDR map).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    pub admin: Address,
    pub agent: Address,
    pub token: Address,
    pub daily_limit: i128,
    pub per_task_limit: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Session {
    pub agent: Address,
    pub valid_until: u64,
    pub limit: i128,
    pub spent: i128,
}

struct World<'a> {
    env: &'a Env,
    owner: Address,
    token: Address,
    token_client: TokenClient<'a>,
    registry: Address,
    factory: TreasuryFactoryClient<'a>,
}

const OWNER_START: i128 = 1_000_000_000;

/// Needs `env.mock_all_auths()` first: the mint is admin-signed.
fn world(env: &Env) -> World<'_> {
    let owner = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(owner.clone());
    let token = sac.address();
    StellarAssetClient::new(env, &token).mint(&owner, &OWNER_START);

    let treasury_wasm = env.deployer().upload_contract_wasm(TREASURY_WASM);
    assert_eq!(
        treasury_wasm,
        BytesN::from_array(env, &TREASURY_V3_5_HASH),
        "fixture is not the shipped v3.5 treasury"
    );
    let registry = env.register(REGISTRY_WASM, ());
    let factory_id = env.register(TreasuryFactory, (treasury_wasm, registry.clone()));

    World {
        env,
        owner,
        token: token.clone(),
        token_client: TokenClient::new(env, &token),
        registry,
        factory: TreasuryFactoryClient::new(env, &factory_id),
    }
}

fn setup(w: &World, leash: Option<Leash>, fund: i128, register: bool) -> Setup {
    let payee = Address::generate(w.env);
    let mut leashes = soroban_sdk::Vec::new(w.env);
    if let Some(l) = leash {
        leashes.push_back(l);
    }
    Setup {
        owner: w.owner.clone(),
        token: w.token.clone(),
        daily_limit: 1_000_000_000,
        per_task_limit: 100_000_000,
        payees: vec![w.env, payee],
        leash: leashes,
        fund,
        register,
        salt: BytesN::from_array(w.env, &[7u8; 32]),
    }
}

/// Reads on the created treasury, through its real (wasm) interface.
fn read<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    contract: &Address,
    fn_name: &str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) -> T {
    env.invoke_contract(contract, &Symbol::new(env, fn_name), args)
}

fn owned_by(env: &Env, registry: &Address, owner: &Address) -> soroban_sdk::Vec<Address> {
    read(env, registry, "treasuries_of", vec![env, owner.into_val(env)])
}

#[test]
fn create_deploys_configures_funds_and_registers_in_one_call() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_800_000_000);
    let w = world(&env);
    let agent = Address::generate(&env);
    let s = setup(
        &w,
        Some(Leash { agent: agent.clone(), valid_until: 1_800_086_400, limit: 300_000_000 }),
        200_000_000,
        true,
    );
    let payee = s.payees.get(0).unwrap();

    let treasury = w.factory.create(&s);

    let cfg: Config = read(&env, &treasury, "get_config", vec![&env]);
    assert_eq!(cfg.admin, w.owner);
    assert_eq!(cfg.agent, w.owner);
    assert_eq!(cfg.token, w.token);
    assert_eq!(cfg.daily_limit, 1_000_000_000);
    assert_eq!(cfg.per_task_limit, 100_000_000);

    let allowed: bool = read(&env, &treasury, "is_payee", vec![&env, payee.into_val(&env)]);
    assert!(allowed);
    let stranger: bool =
        read(&env, &treasury, "is_payee", vec![&env, Address::generate(&env).into_val(&env)]);
    assert!(!stranger);

    let session: Option<Session> = read(&env, &treasury, "get_session", vec![&env]);
    let session = session.expect("leash set");
    assert_eq!(session.agent, agent);
    assert_eq!(session.valid_until, 1_800_086_400);
    assert_eq!(session.limit, 300_000_000);
    assert_eq!(session.spent, 0);

    assert_eq!(w.token_client.balance(&treasury), 200_000_000);
    assert_eq!(w.token_client.balance(&w.owner), OWNER_START - 200_000_000);

    let owned = owned_by(&env, &w.registry, &w.owner);
    assert_eq!(owned.len(), 1);
    assert_eq!(owned.get(0).unwrap(), treasury);
}

/// The whole point: the owner authorises ONE root invocation; everything else hangs off it.
#[test]
fn the_owner_authorises_exactly_one_root_invocation() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_800_000_000);
    let w = world(&env);
    let agent = Address::generate(&env);
    let s = setup(
        &w,
        Some(Leash { agent, valid_until: 1_800_086_400, limit: 300_000_000 }),
        200_000_000,
        true,
    );
    w.factory.create(&s);

    let owner_roots: std::vec::Vec<AuthorizedInvocation> = env
        .auths()
        .into_iter()
        .filter(|(who, _)| *who == w.owner)
        .map(|(_, inv)| inv)
        .collect();
    assert_eq!(owner_roots.len(), 1, "one signature for the whole setup");
    let root = &owner_roots[0];
    match &root.function {
        AuthorizedFunction::Contract((contract, name, _)) => {
            assert_eq!(contract, &w.factory.address);
            assert_eq!(name, &Symbol::new(&env, "create"));
        }
        other => panic!("unexpected root: {:?}", other),
    }
    // payee, leash, funding transfer, registry — all children of that one root
    let names: std::vec::Vec<Symbol> = root
        .sub_invocations
        .iter()
        .map(|i| match &i.function {
            AuthorizedFunction::Contract((_, name, _)) => name.clone(),
            other => panic!("unexpected child: {:?}", other),
        })
        .collect();
    assert_eq!(names.len(), 4, "{:?}", names);
    for expected in ["add_payee", "set_session", "transfer", "register"] {
        assert!(names.contains(&Symbol::new(&env, expected)), "missing {expected}");
    }
}

#[test]
fn optional_parts_are_skipped_when_not_asked_for() {
    let env = Env::default();
    env.mock_all_auths();
    let w = world(&env);
    let s = setup(&w, None, 0, false);

    let treasury = w.factory.create(&s);

    let session: Option<Session> = read(&env, &treasury, "get_session", vec![&env]);
    assert!(session.is_none());
    assert_eq!(w.token_client.balance(&treasury), 0);
    assert_eq!(w.token_client.balance(&w.owner), OWNER_START);
    assert_eq!(owned_by(&env, &w.registry, &w.owner).len(), 0);
}

#[test]
fn create_requires_the_owner_signature() {
    let env = Env::default();
    env.mock_all_auths();
    let w = world(&env);
    let s = setup(&w, None, 0, false);
    env.set_auths(&[]);
    assert!(w.factory.try_create(&s).is_err());
}

#[test]
#[should_panic]
fn an_incoherent_policy_fails_the_whole_creation() {
    let env = Env::default();
    env.mock_all_auths();
    let w = world(&env);
    let mut s = setup(&w, None, 0, false);
    s.per_task_limit = s.daily_limit + 1; // per-payment above daily: the treasury refuses it
    w.factory.create(&s);
}

#[test]
fn an_invalid_leash_aborts_everything_including_funding() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_800_000_000);
    let w = world(&env);
    let expired = Leash { agent: Address::generate(&env), valid_until: 1_799_999_999, limit: 1 };
    let s = setup(&w, Some(expired), 200_000_000, true);

    assert!(w.factory.try_create(&s).is_err());
    // nothing moved, nothing registered
    assert_eq!(w.token_client.balance(&w.owner), OWNER_START);
    assert_eq!(owned_by(&env, &w.registry, &w.owner).len(), 0);
}

#[test]
fn two_treasuries_need_two_salts() {
    let env = Env::default();
    env.mock_all_auths();
    let w = world(&env);
    let a = w.factory.create(&setup(&w, None, 0, false));
    let mut s2 = setup(&w, None, 0, false);
    s2.salt = BytesN::from_array(&env, &[8u8; 32]);
    let b = w.factory.create(&s2);
    assert_ne!(a, b);
    assert!(w.factory.try_create(&setup(&w, None, 0, false)).is_err(), "same salt twice");
}

#[test]
fn the_factory_reports_what_it_instantiates() {
    let env = Env::default();
    env.mock_all_auths();
    let w = world(&env);
    assert_eq!(w.factory.treasury_wasm(), BytesN::from_array(&env, &TREASURY_V3_5_HASH));
    assert_eq!(w.factory.registry(), w.registry);
}
