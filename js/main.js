document.addEventListener('DOMContentLoaded', () => {
    const toggleAuthBtn = document.getElementById('toggle-auth');
    const authTitle = document.getElementById('auth-title');
    const authForm = document.getElementById('auth-form');
    const submitBtn = document.getElementById('auth-submit');
    const notice = document.getElementById('auth-notice');
    const nameInput = document.getElementById('auth-name');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    let isLogin = true;

    function syncAuthMode() {
        authTitle.innerText = isLogin ? '私人放映室' : '访客名册登记';
        submitBtn.innerText = isLogin ? '落 座' : '签 署';
        toggleAuthBtn.innerText = isLogin ? '获取入场券' : '返回放映室';
        nameInput.parentElement.hidden = isLogin;
        nameInput.disabled = isLogin;
        nameInput.required = !isLogin;
    }

    if (toggleAuthBtn) {
        toggleAuthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            isLogin = !isLogin;
            syncAuthMode();
        });
    }

    if (authForm) {
        syncAuthMode();
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            notice.textContent = '';

            try {
                const payload = isLogin
                    ? { email: emailInput.value.trim(), password: passwordInput.value }
                    : { displayName: nameInput.value.trim(), email: emailInput.value.trim(), password: passwordInput.value };
                const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
                await AnchorApi.request(endpoint, { method: 'POST', body: JSON.stringify(payload) });
                AnchorApi.clearCurrentUser();
                window.location.href = 'search.html';
            } catch (error) {
                notice.textContent = error.message;
            }
        });
    }
});
