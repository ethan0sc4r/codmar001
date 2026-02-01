
export const navigation = {
    currentPage: 'dashboard',

    init() {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const page = tab.dataset.page;
                this.navigateTo(page);
            });
        });
    },

    navigateTo(page) {
        document.querySelectorAll('.page-content').forEach(p => {
            p.classList.remove('active');
        });

        document.querySelectorAll('.nav-tab').forEach(t => {
            t.classList.remove('active');
        });

        document.getElementById(`page-${page}`).classList.add('active');

        document.querySelector(`[data-page="${page}"]`).classList.add('active');

        this.currentPage = page;

        this.onPageChange(page);
    },

    onPageChange(page) {
        if (window.pageCallbacks && window.pageCallbacks[page]) {
            window.pageCallbacks[page]();
        }
    }
};
