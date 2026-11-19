-- Website signups must not create a studio profile. The app created profiles from its own login.
drop trigger if exists studio_on_auth_user_created on auth.users;
