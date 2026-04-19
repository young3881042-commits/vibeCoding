pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    triggers {
        pollSCM('H/2 * * * *')
    }

    environment {
        KUBE_NAMESPACE = 'jupiter'
        API_SECRET = 'jupiter-api-source'
        WEB_SECRET = 'jupiter-frontend-archive-source'
        API_DEPLOYMENT = 'jupiter-api'
        WEB_DEPLOYMENT = 'jupiter-web'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Deploy') {
            steps {
                sh 'bash scripts/deploy_jupiter_from_source.sh'
            }
        }

        stage('Smoke Test') {
            steps {
                sh 'bash scripts/smoke_test_jupiter.sh'
            }
        }
    }

    post {
        success {
            echo 'Jupiter 자동배포 완료'
        }
        failure {
            echo 'Jupiter 자동배포 실패'
        }
    }
}
