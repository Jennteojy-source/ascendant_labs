document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Navigation ---
    const mobileNavToggle = document.getElementById('mobileNavToggle');
    const navMenu = document.getElementById('navMenu');
    
    if (mobileNavToggle && navMenu) {
        mobileNavToggle.addEventListener('click', () => {
            mobileNavToggle.classList.toggle('open');
            navMenu.classList.toggle('open');
        });

        // Close menu when clicking navigation items
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                mobileNavToggle.classList.remove('open');
                navMenu.classList.remove('open');
            });
        });
    }

    // --- Theme Toggle (Dark/Light) ---
    const themeToggleBtn = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;

    // Check system preference or localStorage
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    
    const initialTheme = savedTheme || (systemPrefersLight ? 'light' : 'dark');
    htmlElement.setAttribute('data-theme', initialTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = htmlElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            htmlElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    // --- Scroll-Triggered Animations (Intersection Observer) ---
    const animatedElements = document.querySelectorAll('.animate-fade-in, .animate-slide-up, .animate-scale-up');
    
    const animationObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animated');
                // If it's a stats card, trigger counter animation
                if (entry.target.querySelector('.stat-num')) {
                    animateCounter(entry.target.querySelector('.stat-num'));
                }
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    animatedElements.forEach(el => {
        animationObserver.observe(el);
    });

    // Make stats cards observe-ready
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        animationObserver.observe(card);
    });

    // Counter animation logic
    function animateCounter(counterEl) {
        const targetVal = parseFloat(counterEl.getAttribute('data-val'));
        let startVal = 0;
        const duration = 1500; // ms
        const frameRate = 1000 / 60; // 60fps
        const totalFrames = Math.round(duration / frameRate);
        let frame = 0;

        const suffix = counterEl.textContent.replace(/[0\.]/g, ''); // Extract 'M+', 'x', '%'

        const timer = setInterval(() => {
            frame++;
            const progress = frame / totalFrames;
            // Ease out quad formula
            const easeProgress = progress * (2 - progress);
            const currentVal = startVal + (targetVal - startVal) * easeProgress;

            if (targetVal % 1 === 0) {
                counterEl.textContent = Math.floor(currentVal) + suffix;
            } else {
                counterEl.textContent = currentVal.toFixed(1) + suffix;
            }

            if (frame >= totalFrames) {
                clearInterval(timer);
                if (targetVal % 1 === 0) {
                    counterEl.textContent = targetVal + suffix;
                } else {
                    counterEl.textContent = targetVal.toFixed(1) + suffix;
                }
            }
        }, frameRate);
    }



    // --- Contact Form Email Generation ---
    const emailForm = document.getElementById('emailForm');
    if (emailForm) {
        emailForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const name = document.getElementById('formName').value;
            const email = document.getElementById('formEmail').value;
            const website = document.getElementById('formWebsite').value;
            const message = document.getElementById('formMessage').value;
            
            const recipient = 'contact@ascendantlabs.co';
            const subject = encodeURIComponent('Ascendant Labs - Campaign Audit Request');
            
            const bodyText = `Hello Ascendant Labs Team,\n\nI'd like to request a campaign audit for my business. Here are my details:\n\n- Name: ${name}\n- Email: ${email}\n- Website: ${website}\n- Marketing Goals: ${message}\n\nThank you,\n${name}`;
            
            const body = encodeURIComponent(bodyText);
            const mailtoUrl = `mailto:${recipient}?subject=${subject}&body=${body}`;
            
            // Redirect browser window to launch local mail client
            window.location.href = mailtoUrl;
        });
    }
});
